"use strict";
// elizaplus guard: a small validating proxy that sits between nginx and an OpenAI-compatible
// model server (LM Studio). It only ever forwards a fixed, whitelisted request shape, caps the
// size of replies, limits each user's request rate, and limits how many requests the model
// sees at once (extra requests wait briefly in a queue, then are refused with HTTP 429).
//
// Privacy: it never logs or stores message text. Log lines hold only the user name, the HTTP
// status, the duration and whether the request streamed.
//
// Trust: listen on loopback only. nginx must set the user header itself (proxy_set_header), so a
// client can never choose its own name. No dependencies; built-in Node modules only.

const http = require("node:http");
const { Readable } = require("node:stream");

function loadConfig(env = process.env) {
  const num = (name, dflt) => {
    const v = env[name];
    if (v === undefined || v === "") return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
    return n;
  };
  const upstream = env.GUARD_UPSTREAM;
  const model = env.GUARD_MODEL;
  if (!upstream) throw new Error("GUARD_UPSTREAM is required (a full URL, using a hostname)");
  if (!model) throw new Error("GUARD_MODEL is required");
  return {
    host: env.GUARD_HOST || "127.0.0.1",
    port: num("GUARD_PORT", 3100),
    upstream,
    model,
    userHeader: (env.GUARD_USER_HEADER || "x-auth-user").toLowerCase(),
    maxBodyBytes: num("GUARD_MAX_BODY_BYTES", 8192),
    maxMessages: num("GUARD_MAX_MESSAGES", 12),
    maxChars: num("GUARD_MAX_CHARS", 6000),
    maxTokens: num("GUARD_MAX_TOKENS", 300),
    ratePerMin: num("GUARD_RATE_PER_MIN", 30),
    burst: num("GUARD_BURST", 10),
    maxConcurrent: num("GUARD_MAX_CONCURRENT", 2),
    perUserConcurrent: num("GUARD_PER_USER_CONCURRENT", 2),
    maxQueue: num("GUARD_MAX_QUEUE", 20),
    queueWaitMs: num("GUARD_QUEUE_WAIT_MS", 20000),
    upstreamTimeoutMs: num("GUARD_UPSTREAM_TIMEOUT_MS", 60000),
  };
}

// Returns { payload } (the only fields that may reach the model) or { error }.
function validate(body, cfg) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body must be a JSON object" };
  if (body.model !== cfg.model) return { error: "model not allowed" };
  const msgs = body.messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > cfg.maxMessages) return { error: "bad messages" };
  let chars = 0;
  const messages = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object") return { error: "bad message" };
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") return { error: "bad role" };
    if (typeof m.content !== "string") return { error: "bad content" };
    chars += m.content.length;
    messages.push({ role: m.role, content: m.content });
  }
  if (chars > cfg.maxChars) return { error: "messages too long" };
  let maxTokens = cfg.maxTokens;
  if (body.max_tokens !== undefined) {
    if (!Number.isFinite(body.max_tokens) || body.max_tokens < 1) return { error: "bad max_tokens" };
    maxTokens = Math.min(Math.floor(body.max_tokens), cfg.maxTokens);
  }
  let temperature = 0.8;
  if (body.temperature !== undefined) {
    if (!Number.isFinite(body.temperature)) return { error: "bad temperature" };
    temperature = Math.min(Math.max(body.temperature, 0), 1.5);
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") return { error: "bad stream" };
  return {
    payload: {
      model: cfg.model,
      messages,
      max_tokens: maxTokens,
      temperature,
      reasoning_effort: "none",
      stream: body.stream === true,
    },
  };
}

// Token bucket per user: `burst` requests at once, refilled at `ratePerMin` per minute.
function makeRateLimiter(cfg, now = () => Date.now()) {
  const buckets = new Map();
  return function allow(user) {
    const t = now();
    let b = buckets.get(user);
    if (!b) {
      if (buckets.size > 5000) buckets.clear();   // bound memory; worst case everyone gets a fresh bucket
      b = { tokens: cfg.burst, last: t };
      buckets.set(user, b);
    }
    b.tokens = Math.min(cfg.burst, b.tokens + ((t - b.last) / 60000) * cfg.ratePerMin);
    b.last = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

// At most `max` requests run at once; up to `maxQueue` more wait up to `waitMs`.
function makeSlots(cfg) {
  let running = 0;
  const waiting = [];
  function release() {
    running -= 1;
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); running += 1; next.resolve(release); }
  }
  return function acquire() {
    if (running < cfg.maxConcurrent) { running += 1; return Promise.resolve(release); }
    if (waiting.length >= cfg.maxQueue) return Promise.resolve(null);
    return new Promise((resolve) => {
      const entry = { resolve };
      entry.timer = setTimeout(() => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        resolve(null);
      }, cfg.queueWaitMs);
      waiting.push(entry);
    });
  };
}

function createGuard(cfg, { log = (o) => console.log(JSON.stringify(o)), now = () => Date.now() } = {}) {
  const allow = makeRateLimiter(cfg, now);
  const acquire = makeSlots(cfg);
  const perUser = new Map();

  function send(res, status, obj, extra = {}) {
    if (res.headersSent) return;
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
    res.end(JSON.stringify(obj));
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > cfg.maxBodyBytes) return null;
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  return http.createServer(async (req, res) => {
    const started = now();
    const hdr = req.headers[cfg.userHeader];
    const user = (typeof hdr === "string" && hdr.trim() ? hdr.trim().slice(0, 100) : "anonymous");
    const done = (status, stream) => log({ t: new Date(started).toISOString(), user, status, ms: now() - started, stream: !!stream });

    const path = (req.url || "").split("?")[0];
    if (path !== "/api/chat" && path !== "/v1/chat/completions") { send(res, 404, { error: "not found" }); return done(404); }
    if (req.method !== "POST") { send(res, 405, { error: "POST only" }, { Allow: "POST" }); return done(405); }

    const raw = await readBody(req);
    if (raw === null) { send(res, 413, { error: "request too large" }); req.resume(); return done(413); }
    let body;
    try { body = JSON.parse(raw); } catch { send(res, 400, { error: "invalid JSON" }); return done(400); }
    const v = validate(body, cfg);
    if (v.error) { send(res, 400, { error: v.error }); return done(400); }

    if (!allow(user)) { send(res, 429, { error: "too many requests" }, { "Retry-After": "10" }); return done(429); }
    if ((perUser.get(user) || 0) >= cfg.perUserConcurrent) { send(res, 429, { error: "too many at once" }, { "Retry-After": "5" }); return done(429); }

    perUser.set(user, (perUser.get(user) || 0) + 1);
    const release = await acquire();
    if (!release) {
      perUser.set(user, perUser.get(user) - 1);
      send(res, 429, { error: "busy" }, { "Retry-After": "10" });
      return done(429);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.upstreamTimeoutMs);
    let finished = false;
    const finish = (status) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      release();
      perUser.set(user, Math.max(0, (perUser.get(user) || 1) - 1));
      done(status, v.payload.stream);
    };
    res.on("close", () => { if (!res.writableEnded) controller.abort(); finish(res.statusCode || 499); });

    try {
      const up = await fetch(cfg.upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v.payload),
        signal: controller.signal,
      });
      const type = up.headers.get("content-type") || "application/json";
      res.writeHead(up.status, { "Content-Type": type, "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      if (!up.body) { res.end(); return; }
      Readable.fromWeb(up.body).on("error", () => res.destroy()).pipe(res);
    } catch {
      send(res, 502, { error: "model unavailable" });
    }
  });
}

module.exports = { loadConfig, validate, makeRateLimiter, makeSlots, createGuard };

if (require.main === module) {
  const cfg = loadConfig();
  createGuard(cfg).listen(cfg.port, cfg.host, () => {
    console.log(JSON.stringify({ msg: "elizaplus guard listening", host: cfg.host, port: cfg.port, model: cfg.model }));
  });
}
