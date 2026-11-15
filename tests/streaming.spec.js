// @ts-check
// Streaming of Elizaplus replies (server-sent events), plus the request-size cap.
const { test, expect } = require("@playwright/test");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGE_URL = "file://" + path.join(ROOT, "index.html");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const delta = (t) => "data: " + JSON.stringify({ choices: [{ delta: { content: t } }] }) + "\n\n";
const SSE = { "content-type": "text/event-stream", ...CORS };
const isReply = (b) => /You are Elizaplus/.test(b.messages[0].content);

// A real local server so chunks really arrive one by one. handler(res, body, n) writes the stream.
async function streamServer(handler) {
  const bodies = [];
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      body.__bytes = Buffer.concat(chunks).length;
      bodies.push(body);
      handler(res, body, bodies.length);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/api/chat`;
  return { url, bodies, close: () => { server.closeAllConnections?.(); server.close(); } };
}
async function open(page, url, cps = 0) {
  await page.addInitScript(([u, c]) => { window.ELIZAPLUS_ENDPOINT = u; if (c !== null) window.ELIZAPLUS_TYPING_CPS = c; }, [url, cps]);   // 0 = instant, null = use the page's own speed setting
  await page.goto(PAGE_URL);
  await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
  await page.click("#mode-toggle");
}
async function say(page, text) { await page.fill("#user-input", text); await page.press("#user-input", "Enter"); }
const lastText = (page) => page.locator(".message.eliza").last().locator(".text");

test.describe("Streaming replies", () => {
  test("the request asks for a stream", async ({ page }) => {
    const s = await streamServer((res) => { res.writeHead(200, SSE); res.end(delta("Hi.") + "data: [DONE]\n\n"); });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toHaveText("Hi.");
    expect(s.bodies.filter(isReply)[0].stream).toBe(true);
    s.close();
  });

  test("text appears piece by piece, before the stream has finished", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const s = await streamServer(async (res) => {
      res.writeHead(200, SSE);
      res.write(delta("That sounds "));
      res.write(delta("really hard."));
      await gate;                                     // hold the rest until the test has looked
      res.write(delta(" What happened next?"));
      res.end("data: [DONE]\n\n");
    });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toHaveText("That sounds really hard.");     // partial text is on screen
    await expect(page.locator(".message.pending")).toHaveCount(0);           // not blinking any more
    release();
    await expect(lastText(page)).toHaveText("That sounds really hard. What happened next?");
    s.close();
  });

  test("an event split across two network chunks is still read", async ({ page }) => {
    const full = delta("Split across chunks.");
    const s = await streamServer(async (res) => {
      res.writeHead(200, SSE);
      res.write(full.slice(0, 20)); await sleep(100);
      res.write(full.slice(20));
      res.end("data: [DONE]\n\n");
    });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toHaveText("Split across chunks.");
    s.close();
  });

  test("malformed events and comment lines are ignored", async ({ page }) => {
    const s = await streamServer((res) => {
      res.writeHead(200, SSE);
      res.write(": keep-alive\n\n");
      res.write("data: {not json}\n\n");
      res.write(delta("Fine."));
      res.write("data: " + JSON.stringify({ choices: [{ delta: {} }] }) + "\n\n");
      res.end("data: [DONE]\n\n");
    });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toHaveText("Fine.");
    s.close();
  });

  test("streamed text is plain text, never HTML", async ({ page }) => {
    const s = await streamServer((res) => { res.writeHead(200, SSE); res.end(delta('<img src=x onerror="window.__p=1">') + delta("<b>x</b>") + "data: [DONE]\n\n"); });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toContainText("<b>x</b>");
    expect(await page.evaluate(() => window.__p)).toBeUndefined();
    expect(await page.locator(".message .text img, .message .text b").count()).toBe(0);
    s.close();
  });

  test("a stream with no text gives the friendly line", async ({ page }) => {
    const s = await streamServer((res) => { res.writeHead(200, SSE); res.end("data: [DONE]\n\n"); });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toHaveText(/lost my train of thought/);
    s.close();
  });

  test("a stream that breaks part-way keeps the text that arrived, and it counts as context", async ({ page }) => {
    const s = await streamServer(async (res, body, n) => {
      res.writeHead(200, SSE);
      if (n === 1) { res.write(delta("I was about to say")); await sleep(150); res.destroy(); return; }
      res.end(delta("Go on.") + "data: [DONE]\n\n");
    });
    await open(page, s.url);
    await say(page, "first");
    await expect(lastText(page)).toHaveText("I was about to say");
    await page.waitForTimeout(600);                  // the server breaks the stream 150 ms after the text
    await expect(lastText(page)).toHaveText("I was about to say");
    await say(page, "second");
    await expect(lastText(page)).toHaveText("Go on.");
    const msgs = s.bodies.filter(isReply)[1].messages.slice(1);
    expect(msgs.some((m) => m.role === "assistant" && m.content === "I was about to say")).toBe(true);
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    s.close();
  });

  test("a stream that breaks before any text gives the friendly line", async ({ page }) => {
    const s = await streamServer(async (res) => { res.writeHead(200, SSE); res.write(": hi\n\n"); await sleep(100); res.destroy(); });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toHaveText(/lost my train of thought/);
    s.close();
  });

  test("switching back to ELIZA mid-stream drops the reply and later text never appears", async ({ page }) => {
    const s = await streamServer(async (res) => {
      res.writeHead(200, SSE);
      res.write(delta("Starting a long"));
      await sleep(1200);
      try { res.write(delta(" LATE TEXT")); res.end("data: [DONE]\n\n"); } catch (e) { /* closed */ }
    });
    await open(page, s.url);
    await say(page, "hello");
    await expect(lastText(page)).toHaveText("Starting a long");
    await page.click("#mode-toggle");
    await page.waitForTimeout(1500);
    await expect(page.locator("body")).not.toContainText("LATE TEXT");
    await expect(page.locator("body")).not.toContainText("Starting a long");
    s.close();
  });

  test("a newer message replaces a half-streamed reply", async ({ page }) => {
    const s = await streamServer(async (res, body, n) => {
      res.writeHead(200, SSE);
      if (n === 1) { res.write(delta("old answer starts")); await sleep(1500); try { res.write(delta(" OLD END")); res.end(); } catch (e) { /* closed */ } return; }
      res.end(delta("new answer") + "data: [DONE]\n\n");
    });
    await open(page, s.url);
    await say(page, "one");
    await expect(lastText(page)).toHaveText("old answer starts");
    await say(page, "two");
    await expect(lastText(page)).toHaveText("new answer");
    await page.waitForTimeout(1500);
    await expect(page.locator("body")).not.toContainText("OLD END");
    await expect(page.locator(".message.eliza .text", { hasText: "old answer" })).toHaveCount(0);
    s.close();
  });

  test("a very long stream is cut to a readable length", async ({ page }) => {
    const s = await streamServer((res) => { res.writeHead(200, SSE); for (let i = 0; i < 300; i++) res.write(delta("word ")); res.end("data: [DONE]\n\n"); });
    await open(page, s.url);
    await say(page, "hello");
    await expect.poll(async () => (await lastText(page).innerText()).endsWith("…")).toBe(true);
    expect((await lastText(page).innerText()).length).toBeLessThanOrEqual(601);
    s.close();
  });

  test("inner-voice thoughts are still whole (no stream flag) in ELIZA mode", async ({ page }) => {
    const s = await streamServer((res) => { res.writeHead(200, { "content-type": "application/json", ...CORS }); res.end(JSON.stringify({ choices: [{ message: { content: "a thought" } }] })); });
    await page.addInitScript((u) => { window.ELIZAPLUS_ENDPOINT = u; }, s.url);
    await page.goto(PAGE_URL);
    await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
    await say(page, "hello");
    await expect(page.locator(".thought")).toHaveText("a thought");
    expect(s.bodies[0].stream).toBeUndefined();
    s.close();
  });
});

test.describe("Request size cap (the web server rejects bodies over 8 KB)", () => {
  test("long messages and a long conversation stay well under 8 KB, newest message kept", async ({ page }) => {
    const s = await streamServer((res) => { res.writeHead(200, SSE); res.end(delta("ok " + "x".repeat(500)) + "data: [DONE]\n\n"); });
    await open(page, s.url);
    for (let i = 0; i < 6; i++) {
      await say(page, "message " + i + " " + "long ".repeat(800));
      await expect.poll(() => s.bodies.filter(isReply).length).toBe(i + 1);
      await expect(page.locator(".message.pending")).toHaveCount(0);
    }
    for (const b of s.bodies.filter(isReply)) {
      expect(b.__bytes).toBeLessThan(7000);
      for (const m of b.messages.slice(1)) expect(m.content.length).toBeLessThanOrEqual(1001);
    }
    const last = s.bodies.filter(isReply).at(-1).messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content).toContain("message 5");
    s.close();
  });

  test("the proxy limit and the client caps agree in the repository", () => {
    const conf = fs.readFileSync(path.join(ROOT, "deploy/nginx-elizaplus.conf"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, "eliza.js"), "utf8");
    expect(conf).toContain("client_max_body_size 8k");
    expect(conf).toMatch(/location = \/api\/chat[\s\S]*proxy_buffering off/);     // streaming needs this
    expect(js).toContain("PLUS_TOTAL_MAX_CHARS = 5000");
    expect(js).toContain("PLUS_MSG_MAX_CHARS = 1000");
  });
});

test.describe("Typing pace (experiment)", () => {
  const REPLY = "That sounds really hard, and I am glad you said it out loud. What happened next?";
  const whole = (res) => { res.writeHead(200, SSE); res.end(delta(REPLY) + "data: [DONE]\n\n"); };

  test("a fast stream is typed out gradually, ending with the full reply", async ({ page }) => {
    const s = await streamServer(whole);
    await open(page, s.url, 100);
    await say(page, "hello");
    const lengths = new Set();
    for (let i = 0; i < 80; i++) {
      lengths.add((await lastText(page).innerText()).length);
      if ((await lastText(page).innerText()) === REPLY) break;
      await page.waitForTimeout(50);
    }
    expect(await lastText(page).innerText()).toBe(REPLY);
    expect(lengths.size).toBeGreaterThan(5);                          // it did not just appear
    s.close();
  });

  test("the typed text is always a prefix of the reply", async ({ page }) => {
    const s = await streamServer(whole);
    await open(page, s.url, 100);
    await say(page, "hello");
    for (let i = 0; i < 40; i++) {
      const t = await lastText(page).innerText();
      if (t !== "…") expect(REPLY.startsWith(t)).toBe(true);
      if (t === REPLY) break;
      await page.waitForTimeout(60);
    }
    s.close();
  });

  test("the full reply is in the context at once, even while it is still being typed", async ({ page }) => {
    const s = await streamServer((res, b, n) => { res.writeHead(200, SSE); res.end(delta(n === 1 ? REPLY : "ok") + "data: [DONE]\n\n"); });
    await open(page, s.url, 20);                                       // slow: ~4 s for the reply
    await say(page, "first");
    await expect.poll(async () => (await lastText(page).innerText()).length).toBeGreaterThan(2);
    expect((await lastText(page).innerText()).length).toBeLessThan(REPLY.length);
    await say(page, "second");                                         // sent while the first reply is mid-typing
    await expect(page.locator(".message.eliza .text", { hasText: REPLY })).toHaveCount(1);   // flushed to the full text at once
    await expect(lastText(page)).toBeVisible();
    const msgs = s.bodies.filter(isReply)[1].messages.slice(1);
    expect(msgs.some((m) => m.role === "assistant" && m.content === REPLY)).toBe(true);
    s.close();
  });

  test("switching back to ELIZA while typing shows the rest of the reply at once", async ({ page }) => {
    const s = await streamServer(whole);
    await open(page, s.url, 20);
    await say(page, "hello");
    await expect.poll(async () => (await lastText(page).innerText()).length).toBeGreaterThan(2);
    await page.click("#mode-toggle");
    await expect(page.locator(".message.eliza .text", { hasText: REPLY })).toHaveCount(1);
    s.close();
  });

  test("a reply that is cancelled while still streaming leaves nothing behind", async ({ page }) => {
    const s = await streamServer(async (res) => { res.writeHead(200, SSE); res.write(delta("Starting a long reply that never finishes")); await sleep(1500); try { res.end(); } catch (e) { /* closed */ } });
    await open(page, s.url, 100);
    await say(page, "hello");
    await expect.poll(async () => (await lastText(page).innerText()).length).toBeGreaterThan(5);
    await page.click("#mode-toggle");
    await page.waitForTimeout(500);
    await expect(page.locator("body")).not.toContainText("Starting a long");
    s.close();
  });

  test("the three speeds are slow < normal < fast, and normal is the default", () => {
    const js = fs.readFileSync(path.join(ROOT, "eliza.js"), "utf8");
    expect(js).toContain("{ slow: 25, normal: 45, fast: 90 }");
    expect(js).toContain('let typingSpeed = "normal"');
  });
});

test.describe("Typing speed setting (experiment)", () => {
  const LONG = "word ".repeat(60).trim();
  const long = (res) => { res.writeHead(200, SSE); res.end(delta(LONG) + "data: [DONE]\n\n"); };
  const speed = (page) => page.locator("#speed-toggle");

  test("the button only exists while Elizaplus is answering", async ({ page }) => {
    const s = await streamServer(long);
    await page.addInitScript((u) => { window.ELIZAPLUS_ENDPOINT = u; }, s.url);
    await page.goto(PAGE_URL);
    await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
    await expect(speed(page)).toBeHidden();
    await page.click("#mode-toggle");
    await expect(speed(page)).toBeVisible();
    await expect(speed(page)).toHaveText("typing: normal");
    await page.click("#mode-toggle");
    await expect(speed(page)).toBeHidden();
    s.close();
  });

  test("clicking cycles slow, normal, fast and back, and works from the keyboard", async ({ page }) => {
    const s = await streamServer(long);
    await open(page, s.url, null);
    await expect(speed(page)).toHaveText("typing: normal");
    await speed(page).click();
    await expect(speed(page)).toHaveText("typing: fast");
    await speed(page).click();
    await expect(speed(page)).toHaveText("typing: slow");
    await speed(page).focus();
    await page.keyboard.press("Enter");
    await expect(speed(page)).toHaveText("typing: normal");
    s.close();
  });

  test("the button stays hidden when there is no service (file://)", async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
    await expect(speed(page)).toBeHidden();
  });

  test("fast really types faster than slow", async ({ page, browser }) => {
    const s = await streamServer(long);
    const typedAfter = async (pg, clicks) => {
      await open(pg, s.url, null);
      for (let i = 0; i < clicks; i++) await speed(pg).click();
      await say(pg, "hello");
      await expect.poll(async () => (await lastText(pg).innerText()).length).toBeGreaterThan(0);
      await pg.waitForTimeout(1500);
      return (await lastText(pg).innerText()).length;
    };
    const slow = await typedAfter(page, 2);            // normal -> fast -> slow
    const page2 = await browser.newPage();
    const fast = await typedAfter(page2, 1);           // normal -> fast
    await page2.close();
    expect(fast).toBeGreaterThan(slow * 1.8);
    s.close();
  });

  test("changing the speed while she is typing takes effect at once", async ({ page }) => {
    const s = await streamServer(long);
    await open(page, s.url, null);
    await speed(page).click();                         // fast
    await speed(page).click();                         // slow
    await say(page, "hello");
    await expect.poll(async () => (await lastText(page).innerText()).length).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    const before = (await lastText(page).innerText()).length;
    await speed(page).click();                         // normal
    await speed(page).click();                         // fast
    await page.waitForTimeout(1000);
    const gained = (await lastText(page).innerText()).length - before;
    expect(gained).toBeGreaterThan(40);                // slow would add ~25 in a second
    s.close();
  });

  test("the test hook still overrides the setting (instant)", async ({ page }) => {
    const s = await streamServer(long);
    await open(page, s.url, 0);
    await speed(page).click();
    await speed(page).click();                         // slow, but the hook wins
    await say(page, "hello");
    await expect(lastText(page)).toHaveText(LONG, { timeout: 1500 });
    s.close();
  });

  test("the setting is not remembered between visits", async ({ page }) => {
    const s = await streamServer(long);
    await open(page, s.url, null);
    await speed(page).click();
    await expect(speed(page)).toHaveText("typing: fast");
    await page.reload();
    await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
    await page.click("#mode-toggle");
    await expect(speed(page)).toHaveText("typing: normal");
    s.close();
  });
});
