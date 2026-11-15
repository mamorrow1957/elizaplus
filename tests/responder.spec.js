// @ts-check
// The ELIZA / Elizaplus responder switch. Everything runs against a mocked /api/chat.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGE_URL = "file://" + path.join(ROOT, "index.html");
const MOCK = "http://responder.test/api/chat";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

async function withMock(page, handler, opts = {}) {
  const bodies = [];
  await page.addInitScript((o) => {
    window.ELIZAPLUS_ENDPOINT = o.url;
    window.ELIZAPLUS_TYPING_CPS = 0;        // instant: the typing pace has its own tests
    if (o.timeout) window.ELIZAPLUS_REPLY_TIMEOUT_MS = o.timeout;
  }, { url: MOCK, timeout: opts.timeout });
  await page.route(MOCK, async (route, request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    bodies.push(JSON.parse(request.postData() || "{}"));
    return handler(route, request, bodies.length);
  });
  return bodies;
}
const reply = (content) => (route) => route.fulfill({
  status: 200, headers: CORS, contentType: "application/json",
  body: JSON.stringify({ choices: [{ message: { content } }] }),
});
const status = (code) => (route) => route.fulfill({ status: code, headers: CORS, body: "x" });
// Thought requests (inner voice) have a different shape than reply requests; tell them apart by prompt.
const isReplyRequest = (b) => /You are Elizaplus/.test(b.messages[0].content);

async function loadPage(page) {
  await page.goto(PAGE_URL);
  await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
}
async function say(page, text) {
  await page.fill("#user-input", text);
  await page.press("#user-input", "Enter");
}
const speakers = (page) => page.locator(".message .speaker").allInnerTexts();

test.describe("Responder switch", () => {
  test("the switch starts on ELIZA and is hidden when there is no service (file://)", async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator("#mode-toggle")).toBeHidden();
  });

  test("it shows 'responder: ELIZA' with the service available", async ({ page }) => {
    await withMock(page, reply("ok"));
    await loadPage(page);
    await expect(page.locator("#mode-toggle")).toHaveText("responder: ELIZA");
    await expect(page.locator("#mode-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  test("switching on posts an ELIZAPLUS message that says she is taking over and gives a mild disclaimer", async ({ page }) => {
    await withMock(page, reply("ok"));
    await loadPage(page);
    await page.click("#mode-toggle");
    await expect(page.locator("#mode-toggle")).toHaveText("responder: Elizaplus");
    await expect(page.locator("#mode-toggle")).toHaveAttribute("aria-pressed", "true");
    const last = page.locator(".message.eliza").last();
    await expect(last.locator(".speaker")).toHaveText("ELIZAPLUS");
    const text = await last.locator(".text").innerText();
    expect(text).toMatch(/taking over/i);
    expect(text).toMatch(/unreliable/i);
    expect(text).toMatch(/AI/);
  });

  test("replies in Elizaplus mode come from the model and carry the ELIZAPLUS name", async ({ page }) => {
    const bodies = await withMock(page, reply("That sounds heavy. What part of it weighs most?"));
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "I had a rough week");
    const last = page.locator(".message.eliza").last();
    await expect(last.locator(".text")).toHaveText("That sounds heavy. What part of it weighs most?");
    await expect(last.locator(".speaker")).toHaveText("ELIZAPLUS");
    expect(bodies.length).toBe(1);
    expect(isReplyRequest(bodies[0])).toBe(true);
    expect(bodies[0].reasoning_effort).toBe("none");
    expect(bodies[0].messages.at(-1)).toEqual({ role: "user", content: "I had a rough week" });
  });

  test("no inner voice thoughts and no thought requests while Elizaplus answers", async ({ page }) => {
    const bodies = await withMock(page, reply("A reply."));
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "hello there");
    await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText("A reply.");
    await page.waitForTimeout(300);
    expect(await page.locator(".thought").count()).toBe(0);
    expect(bodies.every(isReplyRequest)).toBe(true);
    await expect(page.locator("#voice-toggle")).toBeHidden();
  });

  test("the conversation so far is sent as context, with roles alternating", async ({ page }) => {
    const bodies = await withMock(page, (route, req, n) => {
      const b = JSON.parse(req.postData() || "{}");
      return isReplyRequest(b) ? reply("reply " + n)(route) : reply("a thought")(route);
    });
    await loadPage(page);
    await say(page, "my mother called");           // answered by ELIZA, with a thought request
    await expect(page.locator(".message.eliza")).toHaveCount(2);
    await page.click("#mode-toggle");
    await say(page, "she was upset");
    await expect(page.locator(".message.eliza").last().locator(".text")).toContainText("reply");
    const reqs = bodies.filter(isReplyRequest);
    expect(reqs.length).toBe(1);
    const msgs = reqs[0].messages.slice(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("my mother called");
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    expect(msgs.at(-1)).toEqual({ role: "user", content: "she was upset" });
  });

  test("switching back posts an ELIZA message and classic rules answer again", async ({ page }) => {
    const bodies = await withMock(page, reply("model reply"));
    await loadPage(page);
    await page.click("#mode-toggle");
    await page.click("#mode-toggle");
    await expect(page.locator("#mode-toggle")).toHaveText("responder: ELIZA");
    const last = page.locator(".message.eliza").last();
    await expect(last.locator(".speaker")).toHaveText("ELIZA");
    await expect(last.locator(".text")).toHaveText("I am back. Please, go on.");
    const before = bodies.filter(isReplyRequest).length;
    await say(page, "I am sad");
    await expect(page.locator(".message.eliza")).toHaveCount(3);
    expect(bodies.filter(isReplyRequest).length).toBe(before);
    await expect(page.locator("#voice-toggle")).toBeVisible();
  });

  test("earlier messages keep the name they were written under", async ({ page }) => {
    await withMock(page, reply("model reply"));
    await loadPage(page);
    await say(page, "hello");
    await expect(page.locator(".message.eliza")).toHaveCount(2);
    await page.click("#mode-toggle");
    await say(page, "again");
    await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText("model reply");
    expect(await speakers(page)).toEqual(["ELIZA", "YOU", "ELIZA", "ELIZAPLUS", "YOU", "ELIZAPLUS"]);
  });

  test("the choice is not remembered: a new visit starts on ELIZA", async ({ page }) => {
    await withMock(page, reply("ok"));
    await loadPage(page);
    await page.click("#mode-toggle");
    await page.reload();
    await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator("#mode-toggle")).toHaveText("responder: ELIZA");
  });
});

test.describe("Responder switch: failures and safety", () => {
  for (const [name, handler, expected] of [
    ["a server error", status(500), /lost my train of thought/],
    ["a rate limit", status(429), /catch my breath/],
    ["a malformed response", (route) => route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: "{nope" }), /lost my train of thought/],
    ["an empty reply", reply("   "), /lost my train of thought/],
  ]) {
    test(`${name} gives a friendly line and stays in Elizaplus mode`, async ({ page }) => {
      await withMock(page, handler);
      await loadPage(page);
      await page.click("#mode-toggle");
      await say(page, "hello");
      await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText(expected);
      await expect(page.locator("#mode-toggle")).toHaveText("responder: Elizaplus");
      await expect(page.locator(".message.pending")).toHaveCount(0);
    });
  }

  test("a timeout gives the friendly line", async ({ page }) => {
    await withMock(page, async (route) => { await new Promise((r) => setTimeout(r, 6000)); try { await reply("late")(route); } catch (e) { /* aborted */ } }, { timeout: 1500 });
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "hello");
    await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText(/lost my train of thought/, { timeout: 5000 });
  });

  test("a missing service (404) goes back to ELIZA and hides the switch", async ({ page }) => {
    await withMock(page, status(404));
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "hello");
    await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText(/not available/);
    await expect(page.locator(".message.eliza").last().locator(".speaker")).toHaveText("ELIZA");
    await expect(page.locator("#mode-toggle")).toBeHidden();
    await say(page, "I am sad");
    await expect(page.locator(".message.eliza")).toHaveCount(4);      // classic ELIZA answers again
  });

  test("a failed reply is not added to the context, so the next request stays well formed", async ({ page }) => {
    const bodies = await withMock(page, (route, req, n) => (n === 1 ? status(500)(route) : reply("fine")(route)));
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "first");
    await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText(/lost my train/);
    await say(page, "second");
    await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText("fine");
    const msgs = bodies[1].messages.slice(1);
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    expect(msgs.at(-1).content).toContain("second");
  });

  for (const phrase of ["I want to kill myself", "I keep wanting to hurt myself", "I would be better off dead", "thinking about self-harm"]) {
    test(`self-harm talk ("${phrase}") gets a fixed safe reply and nothing is sent to the model`, async ({ page }) => {
      const bodies = await withMock(page, reply("should not be used"));
      await loadPage(page);
      await page.click("#mode-toggle");
      await say(page, phrase);
      const last = page.locator(".message.eliza").last();
      await expect(last.locator(".text")).toContainText("988");
      await expect(last.locator(".text")).toContainText("not the right help");
      await page.waitForTimeout(300);
      expect(bodies.length).toBe(0);
    });
  }

  test("model text is inserted as plain text, never as HTML", async ({ page }) => {
    await withMock(page, reply('<img src=x onerror="window.__pwned=1"> <b>bold</b>'));
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "hello");
    await expect(page.locator(".message.eliza").last().locator(".text")).toContainText("<b>bold</b>");
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator(".message .text img, .message .text b").count()).toBe(0);
  });

  test("a very long reply is cut with an ellipsis", async ({ page }) => {
    await withMock(page, reply("word ".repeat(300)));
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "hello");
    const text = await page.locator(".message.eliza").last().locator(".text").innerText();
    expect(text.length).toBeLessThanOrEqual(601);
    expect(text.endsWith("…")).toBe(true);
  });

  test("switching back while a reply is pending drops it, and the late answer never appears", async ({ page }) => {
    await withMock(page, async (route) => { await new Promise((r) => setTimeout(r, 1500)); try { await reply("too late")(route); } catch (e) { /* aborted */ } });
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "hello");
    await expect(page.locator(".message.pending")).toHaveCount(1);
    await page.click("#mode-toggle");
    await expect(page.locator(".message.pending")).toHaveCount(0);
    await page.waitForTimeout(2000);
    await expect(page.locator("body")).not.toContainText("too late");
  });

  test("a newer message cancels the pending one and only one answer arrives", async ({ page }) => {
    const bodies = await withMock(page, async (route, req, n) => { if (n === 1) await new Promise((r) => setTimeout(r, 1200)); try { await reply(n === 1 ? "first answer" : "second answer")(route); } catch (e) { /* aborted */ } });
    await loadPage(page);
    await page.click("#mode-toggle");
    await say(page, "one");
    await expect(page.locator(".message.pending")).toHaveCount(1);
    await say(page, "two");
    await expect(page.locator(".message.eliza").last().locator(".text")).toHaveText("second answer");
    await page.waitForTimeout(1500);
    await expect(page.locator("body")).not.toContainText("first answer");
    const msgs = bodies[1].messages.slice(1);
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].role).not.toBe(msgs[i - 1].role);
  });
});

test.describe("Responder switch: page and repository guards", () => {
  test("the fine print mentions that Elizaplus answering also sends messages to the AI model", () => {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    expect(html).toMatch(/Elizaplus answering, your messages are sent to an AI model/);
  });
  test("the Elizaplus prompt does not allow claiming to be human or a therapist", () => {
    const js = fs.readFileSync(path.join(ROOT, "eliza.js"), "utf8");
    expect(js).toContain("never claim to be human or a therapist");
    expect(js).toContain("qualified professional");
    expect(js).not.toMatch(/\.innerHTML\s*=/);
  });
  test("the speaker name is ELIZAPLUS in the code", () => {
    expect(fs.readFileSync(path.join(ROOT, "eliza.js"), "utf8")).toContain('const PLUS_NAME = "ELIZAPLUS"');
  });
});
