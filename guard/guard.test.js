"use strict";
// Guard tests: node --test guard/   (built-in runner, no dependencies, no network, no model needed)
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { loadConfig, validate, makeRateLimiter, createGuard } = require("./guard.js");

const MODEL = "test/model";
const SECRET_TEXT = "my private worry about my landlord";

function baseCfg(over = {}) {
  return {
    host: "127.0.0.1", port: 0, upstream: "", model: MODEL, userHeader: "x-auth-user",
    maxBodyBytes: 8192, maxMessages: 12, maxChars: 6000, maxTokens: 300,
    ratePerMin: 30, burst: 10, maxConcurrent: 2, perUserConcurrent: 2, maxQueue: 20,
    queueWaitMs: 2000, upstreamTimeoutMs: 5000, ...over,
  };
}

// A fake model server. It records the last body it received, can be slowed down, and can stream.
function startUpstream({ delayMs = 0 } = {}) {
  const state = { last: null, hits: 0, active: 0, maxActive: 0 };
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    state.last = JSON.parse(raw);
    state.hits += 1; state.active += 1; state.maxActive = Math.max(state.maxActive, state.active);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (state.last.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "hello" } }] }));
    }
    state.active -= 1;
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}/v1/chat/completions` })));
}

async function startGuard(over = {}, upstreamOpts = {}) {
  const up = await startUpstream(upstreamOpts);
  const logs = [];
  const guard = createGuard(baseCfg({ upstream: up.url, ...over }), { log: (o) => logs.push(o) });
  await new Promise((r) => guard.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${guard.address().port}`;
  const stop = () => { guard.close(); up.server.close(); guard.closeAllConnections?.(); up.server.closeAllConnections?.(); };
  return { base, up, logs, stop };
}

const goodBody = (extra = {}) => ({ model: MODEL, messages: [{ role: "user", content: SECRET_TEXT }], max_tokens: 100, temperature: 0.8, ...extra });
const post = (base, body, headers = {}, path = "/api/chat") =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("loadConfig requires upstream and model, and rejects bad numbers", () => {
  assert.throws(() => loadConfig({}), /GUARD_UPSTREAM/);
  assert.throws(() => loadConfig({ GUARD_UPSTREAM: "http://h:1/v1/chat/completions" }), /GUARD_MODEL/);
  assert.throws(() => loadConfig({ GUARD_UPSTREAM: "http://h", GUARD_MODEL: "m", GUARD_PORT: "abc" }), /GUARD_PORT/);
  const c = loadConfig({ GUARD_UPSTREAM: "http://h", GUARD_MODEL: "m" });
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.maxTokens, 300);
});

test("validate keeps only whitelisted fields and clamps values", () => {
  const cfg = baseCfg();
  const v = validate({ ...goodBody({ max_tokens: 99999, temperature: 9, stream: true, tools: ["x"], top_k: 1, reasoning_effort: "high" }) }, cfg);
  assert.deepEqual(Object.keys(v.payload).sort(), ["max_tokens", "messages", "model", "reasoning_effort", "stream", "temperature"]);
  assert.equal(v.payload.max_tokens, 300);
  assert.equal(v.payload.temperature, 1.5);
  assert.equal(v.payload.reasoning_effort, "none");
  assert.equal(v.payload.stream, true);
});

test("validate rejects wrong model, bad roles, bad shapes and oversized text", () => {
  const cfg = baseCfg();
  assert.ok(validate(goodBody({ model: "other" }), cfg).error);
  assert.ok(validate(goodBody({ messages: [] }), cfg).error);
  assert.ok(validate(goodBody({ messages: [{ role: "tool", content: "x" }] }), cfg).error);
  assert.ok(validate(goodBody({ messages: [{ role: "user", content: 5 }] }), cfg).error);
  assert.ok(validate(goodBody({ messages: Array(13).fill({ role: "user", content: "x" }) }), cfg).error);
  assert.ok(validate(goodBody({ messages: [{ role: "user", content: "x".repeat(6001) }] }), cfg).error);
  assert.ok(validate(goodBody({ max_tokens: -1 }), cfg).error);
  assert.ok(validate(goodBody({ stream: "yes" }), cfg).error);
  assert.ok(validate([], cfg).error);
  assert.ok(validate(null, cfg).error);
});

test("rate limiter: burst, then refill over time, separate per user", () => {
  let t = 0;
  const allow = makeRateLimiter(baseCfg({ burst: 3, ratePerMin: 60 }), () => t);
  assert.equal(allow("a"), true); assert.equal(allow("a"), true); assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true);          // another user is unaffected
  t += 1000;                                // 60/min = 1 per second
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
});

test("forwards a valid request and returns the model's answer", async () => {
  const g = await startGuard();
  try {
    const r = await post(g.base, goodBody());
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "hello");
    assert.equal(g.up.state.last.reasoning_effort, "none");
    assert.equal(g.up.state.last.max_tokens, 100);
  } finally { g.stop(); }
});

test("streams replies through unchanged", async () => {
  const g = await startGuard();
  try {
    const r = await post(g.base, goodBody({ stream: true }));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /event-stream/);
    const text = await r.text();
    assert.match(text, /"he"/); assert.match(text, /"llo"/); assert.match(text, /\[DONE\]/);
  } finally { g.stop(); }
});

test("caps max_tokens and strips unknown fields before they reach the model", async () => {
  const g = await startGuard();
  try {
    await post(g.base, goodBody({ max_tokens: 100000, tools: [{ x: 1 }], n: 50 }));
    assert.equal(g.up.state.last.max_tokens, 300);
    assert.equal(g.up.state.last.tools, undefined);
    assert.equal(g.up.state.last.n, undefined);
  } finally { g.stop(); }
});

test("rejects bad input without calling the model", async () => {
  const g = await startGuard();
  try {
    assert.equal((await post(g.base, goodBody({ model: "other" }))).status, 400);
    assert.equal((await post(g.base, "not json")).status, 400);
    assert.equal((await post(g.base, goodBody({ messages: [{ role: "user", content: "x".repeat(9000) }] }))).status, 413);
    assert.equal((await fetch(g.base + "/api/chat")).status, 405);
    assert.equal((await fetch(g.base + "/other", { method: "POST" })).status, 404);
    assert.equal(g.up.state.hits, 0);
  } finally { g.stop(); }
});

test("rate limit is per user: one heavy user gets 429 with Retry-After, another is fine", async () => {
  const g = await startGuard({ burst: 2, ratePerMin: 1 });
  try {
    const hdr = (u) => ({ "x-auth-user": u });
    assert.equal((await post(g.base, goodBody(), hdr("ann"))).status, 200);
    assert.equal((await post(g.base, goodBody(), hdr("ann"))).status, 200);
    const limited = await post(g.base, goodBody(), hdr("ann"));
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
    assert.equal((await post(g.base, goodBody(), hdr("bob"))).status, 200);
  } finally { g.stop(); }
});

test("concurrency cap: the model never sees more than the limit; extras wait in the queue and succeed", async () => {
  const g = await startGuard({ maxConcurrent: 2, perUserConcurrent: 10, burst: 100 }, { delayMs: 150 });
  try {
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => post(g.base, goodBody(), { "x-auth-user": "u" + i })));
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
    assert.equal(g.up.state.maxActive, 2);
  } finally { g.stop(); }
});

test("a full queue answers 429 busy instead of piling up", async () => {
  const g = await startGuard({ maxConcurrent: 1, maxQueue: 1, perUserConcurrent: 10, burst: 100 }, { delayMs: 300 });
  try {
    const rs = await Promise.all(Array.from({ length: 4 }, (_, i) => post(g.base, goodBody(), { "x-auth-user": "u" + i })));
    const codes = rs.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 200).length, 2);   // one running + one queued
    assert.equal(codes.filter((c) => c === 429).length, 2);
  } finally { g.stop(); }
});

test("per-user concurrency: one user cannot take every slot", async () => {
  const g = await startGuard({ maxConcurrent: 4, perUserConcurrent: 1, burst: 100 }, { delayMs: 300 });
  try {
    const rs = await Promise.all([post(g.base, goodBody(), { "x-auth-user": "ann" }), post(g.base, goodBody(), { "x-auth-user": "ann" })]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 429]);
  } finally { g.stop(); }
});

test("model server down gives 502 and frees the slot", async () => {
  const g = await startGuard({ maxConcurrent: 1 });
  try {
    g.up.server.close(); g.up.server.closeAllConnections();
    assert.equal((await post(g.base, goodBody())).status, 502);
    assert.equal((await post(g.base, goodBody())).status, 502);   // a leaked slot would hang or answer 429 here
  } finally { g.stop(); }
});

test("logs never contain message text, only user, status and timing", async () => {
  const g = await startGuard();
  try {
    await post(g.base, goodBody(), { "x-auth-user": "ann" });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(g.logs.length >= 1);
    const all = JSON.stringify(g.logs);
    assert.ok(!all.includes(SECRET_TEXT));
    assert.deepEqual(Object.keys(g.logs[0]).sort(), ["ms", "status", "stream", "t", "user"]);
    assert.equal(g.logs[0].user, "ann");
  } finally { g.stop(); }
});
