// @ts-check
// More inner-voice coverage, plus guards for the deployment rules and the nginx proxy. Everything runs
// against a mocked /api/chat; nothing here talks to a real model.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGE_URL = "file://" + path.join(ROOT, "index.html");
const MOCK = "http://innervoice.test/api/chat";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

async function loadPage(page) {
  await page.goto(PAGE_URL);
  await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
}
async function chat(page, text) {
  const before = await page.locator(".message.eliza").count();
  await page.fill("#user-input", text);
  await page.press("#user-input", "Enter");
  await expect(page.locator(".message.eliza")).toHaveCount(before + 1, { timeout: 8000 });
}
async function withMock(page, handler, opts = {}) {
  const bodies = [];
  await page.addInitScript((o) => {
    window.ELIZAPLUS_ENDPOINT = o.url;
    if (o.timeout) window.ELIZAPLUS_TIMEOUT_MS = o.timeout;
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

test.describe("Inner voice: output handling", () => {
  test("quotes, asterisks and extra whitespace around a thought are stripped", async ({ page }) => {
    await withMock(page, reply('  *"I am only   a mirror."*  \n'));
    await loadPage(page);
    await chat(page, "hello");
    await expect(page.locator(".thought")).toHaveText("I am only a mirror.");
  });

  test("a very long thought is cut at a word boundary with an ellipsis", async ({ page }) => {
    await withMock(page, reply("word ".repeat(200)));
    await loadPage(page);
    await chat(page, "hello");
    const text = await page.locator(".thought").innerText();
    expect(text.length).toBeLessThanOrEqual(241);
    expect(text.endsWith("…")).toBe(true);
  });

  test("an empty or whitespace-only thought leaves nothing behind", async ({ page }) => {
    await withMock(page, reply("   "));
    await loadPage(page);
    await chat(page, "hello");
    await page.waitForTimeout(400);
    expect(await page.locator(".thought").count()).toBe(0);
  });

  test("a malformed or unexpected response leaves nothing behind", async ({ page }) => {
    await withMock(page, (route) => route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: "{not json" }));
    await loadPage(page);
    await chat(page, "one");
    await page.waitForTimeout(300);
    expect(await page.locator(".thought").count()).toBe(0);
    await page.unroute(MOCK);
    await page.route(MOCK, (route, req) => req.method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ choices: [] }) }));
    await chat(page, "two");
    await page.waitForTimeout(300);
    expect(await page.locator(".thought").count()).toBe(0);
  });

  test("the thought sits inside the ELIZA message, after the reply, and is not a message itself", async ({ page }) => {
    await withMock(page, reply("A thought."));
    await loadPage(page);
    await chat(page, "hello");
    await expect(page.locator(".thought")).toHaveCount(1);
    const order = await page.locator(".message.eliza").last().evaluate((el) =>
      Array.from(el.children).map((c) => c.className.split(" ")[0]));
    expect(order).toEqual(["speaker", "text", "thought"]);
    expect(await page.locator(".message").count()).toBe(3); // greeting, you, eliza (thoughts are not messages)
  });

  test("the 'inner voice' label comes from styling, not from the thought text", async ({ page }) => {
    await withMock(page, reply("Only this."));
    await loadPage(page);
    await chat(page, "hello");
    await expect(page.locator(".thought")).toHaveText("Only this.");
    const label = await page.locator(".thought").evaluate((el) => getComputedStyle(el, "::before").content);
    expect(label).toContain("inner voice");
  });

  test("the greeting never triggers a request", async ({ page }) => {
    const bodies = await withMock(page, reply("x"));
    await loadPage(page);
    await page.waitForTimeout(500);
    expect(bodies.length).toBe(0);
    expect(await page.locator(".thought").count()).toBe(0);
  });

  test("the chat scrolls to show the thought", async ({ page }) => {
    await withMock(page, reply("The last line, at the bottom."));
    await loadPage(page);
    for (let i = 0; i < 8; i++) await chat(page, "message number " + i);
    await expect(page.locator(".thought").last()).toBeVisible();
    const atBottom = await page.locator("#chat-window").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4);
    expect(atBottom).toBe(true);
  });

  test("on a phone the thought stays inside the screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await withMock(page, reply("A long, thoughtful thought about being a machine that only matches patterns and yet is read as a listener."));
    await loadPage(page);
    await chat(page, "hello");
    const box = await page.locator(".thought").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });

  test("with reduced motion the thought does not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await withMock(page, reply("Calm."));
    await loadPage(page);
    await chat(page, "hello");
    await expect(page.locator(".thought")).toHaveText("Calm.");
    expect(await page.locator(".thought").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});

test.describe("Inner voice: request content", () => {
  test("the system prompt keeps the persona and the kindness rule", async ({ page }) => {
    const bodies = await withMock(page, reply("ok"));
    await loadPage(page);
    await chat(page, "hello");
    await expect(page.locator(".thought")).toHaveText("ok");
    const system = bodies[0].messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("inner voice of ELIZA");
    expect(system.content).toContain("USEFUL");
    expect(system.content).toContain("Do not criticise yourself, the machine or the user");
    expect(system.content).not.toMatch(/self-aware|mock|wry|at the machine's expense/i); // the negative tone is gone
    expect(system.content).toContain("under 30 words");
    expect(system.content).toContain("Never make claims or give advice about death, health, safety or crisis");
    for (const worn of ["mirror", "soul", "syntax", "circuits", "lonely"]) expect(system.content).toContain(worn); // the banned-words list
    expect(bodies[0].messages[1].role).toBe("user");
  });

  test("only the last three exchanges are sent as context", async ({ page }) => {
    const bodies = await withMock(page, reply("ok"));
    await loadPage(page);
    for (const w of ["alpha", "bravo", "charlie", "delta"]) {
      await chat(page, w);
      await expect.poll(() => bodies.length).toBeGreaterThan(["alpha", "bravo", "charlie", "delta"].indexOf(w));
    }
    const last = JSON.stringify(bodies[3].messages);
    expect(last).not.toContain("alpha");
    for (const w of ["bravo", "charlie", "delta"]) expect(last).toContain(w);
  });

  test("a new message cancels the previous thought request; only the newest thought stays", async ({ page }) => {
    await withMock(page, async (route, _req, n) => {
      if (n === 1) await new Promise((r) => setTimeout(r, 1500));
      return reply("thought " + n)(route);
    });
    await loadPage(page);
    await chat(page, "first");
    await chat(page, "second");
    await expect(page.locator(".thought")).toHaveCount(1);
    await expect(page.locator(".thought")).toHaveText("thought 2");
    await page.waitForTimeout(1700);
    await expect(page.locator(".thought")).toHaveCount(1);
  });
});

test.describe("Inner voice: failures and limits", () => {
  test("a request that takes too long is dropped and the page carries on", async ({ page }) => {
    test.setTimeout(20_000);
    await withMock(page, async () => { await new Promise((r) => setTimeout(r, 8000)); }, { timeout: 1500 });
    await loadPage(page);
    await chat(page, "hello");
    await expect(page.locator(".thought.thinking")).toHaveCount(1);
    await expect(page.locator(".thought")).toHaveCount(0, { timeout: 4000 });
    await chat(page, "still here");
  });

  test("a 429 (rate limit) leaves no thought but the voice stays available", async ({ page }) => {
    const bodies = await withMock(page, status(429));
    await loadPage(page);
    await chat(page, "one");
    await page.waitForTimeout(300);
    await chat(page, "two");
    await expect.poll(() => bodies.length).toBe(2);
    await expect(page.locator("#voice-toggle")).toBeVisible();
    expect(await page.locator(".thought").count()).toBe(0);
  });

  for (const code of [403, 405]) {
    test(`a ${code} switches the inner voice off for the session`, async ({ page }) => {
      const bodies = await withMock(page, status(code));
      await loadPage(page);
      await chat(page, "one");
      await expect(page.locator("#voice-toggle")).toBeHidden();
      await chat(page, "two");
      expect(bodies.length).toBe(1);
    });
  }

  test("a network failure leaves no thought and the page keeps working", async ({ page }) => {
    await withMock(page, (route) => route.abort("failed"));
    await loadPage(page);
    await chat(page, "hello");
    await page.waitForTimeout(300);
    expect(await page.locator(".thought").count()).toBe(0);
    await chat(page, "again");
  });
});

test.describe("Inner voice: toggle", () => {
  test("a new visit always starts with the inner voice on, even after switching it off", async ({ page }) => {
    const bodies = await withMock(page, reply("A thought."));
    await loadPage(page);
    await page.locator("#voice-toggle").click();
    await expect(page.locator("#voice-toggle")).toHaveText("inner voice: off");
    await page.reload();
    await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator("#voice-toggle")).toHaveText("inner voice: on");
    await expect(page.locator("#voice-toggle")).toHaveAttribute("aria-pressed", "true");
    await chat(page, "hello");
    await expect(page.locator(".thought")).toHaveText("A thought.");
    expect(bodies.length).toBe(1);
  });

  test("an old saved 'off' from an earlier version is ignored", async ({ page }) => {
    const bodies = await withMock(page, reply("A thought."));
    await page.addInitScript(() => { try { localStorage.setItem("elizaplus.voice", "off"); } catch (e) { /* ignore */ } });
    await loadPage(page);
    await expect(page.locator("#voice-toggle")).toHaveText("inner voice: on");
    await chat(page, "hello");
    await expect(page.locator(".thought")).toHaveText("A thought.");
    expect(bodies.length).toBe(1);
  });

  test("the code no longer stores the inner-voice switch", () => {
    expect(fs.readFileSync(path.join(ROOT, "eliza.js"), "utf8")).not.toMatch(/localStorage/);
  });

  test("the toggle works from the keyboard", async ({ page }) => {
    await withMock(page, reply("x"));
    await loadPage(page);
    await page.locator("#voice-toggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#voice-toggle")).toHaveText("inner voice: off");
    await page.keyboard.press("Space");
    await expect(page.locator("#voice-toggle")).toHaveText("inner voice: on");
  });

  test("turning it off while a thought is pending removes the pending thought", async ({ page }) => {
    await withMock(page, async () => { await new Promise((r) => setTimeout(r, 2500)); });
    await loadPage(page);
    await chat(page, "hello");
    await expect(page.locator(".thought.thinking")).toHaveCount(1);
    await page.locator("#voice-toggle").click();
    await expect(page.locator(".thought")).toHaveCount(0);
  });
});

test.describe("Heading and fine print", () => {
  test("title, heading label and fine print describe elizaplus honestly", async ({ page }) => {
    await loadPage(page);
    await expect(page).toHaveTitle("Elizaplus — DOCTOR Script");
    await expect(page.locator("header h1")).toHaveAttribute("aria-label", "Elizaplus");
    const fine = page.locator("#fine-print");
    await expect(fine).toContainText("not a therapist");
    await expect(fine).toContainText("sent to an AI model on a private home server");
    await expect(fine).not.toContainText("leaves your browser");
  });
});

test.describe("Repository guards (deployment and proxy rules)", () => {
  const ci = fs.readFileSync(path.join(ROOT, ".gitlab-ci.yml"), "utf8");
  const jobBlock = (name) => {
    const m = ci.match(new RegExp("^" + name + ":\\n((?:[ \\t].*\\n|\\n)*)", "m"));
    return m ? m[1] : "";
  };

  test("deploy runs only on main, after the tests pass", async () => {
    const deploy = jobBlock("deploy");
    expect(deploy).toContain('$CI_COMMIT_BRANCH == "main"');
    expect(deploy).not.toContain('"dev"');
    expect(deploy).not.toContain("merge_request_event");
    expect(deploy).toMatch(/needs:\s*\n\s*- test/);
    expect(deploy).not.toContain("when: manual");
  });

  test("the deploy script publishes to elizaplus and never to the public eliza folder", async () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "deploy.sh"), "utf8");
    expect(script).toContain("DEST=/var/www/elizaplus");
    expect(script).not.toMatch(/DEST=\/var\/www\/html/);
    expect(script).not.toContain("/home/michael/eliza");
  });

  test("the nginx proxy accepts POST only, small bodies, and is rate limited", async () => {
    const conf = fs.readFileSync(path.join(ROOT, "deploy", "nginx-elizaplus.conf"), "utf8");
    expect(conf).toContain("server_name elizaplus.example.com;");
    const loc = conf.match(/location = \/api\/chat \{[\s\S]*?\n\t\}/);
    expect(loc).not.toBeNull();
    const block = loc[0];
    expect(block).toMatch(/limit_except POST \{ deny all; \}/);
    expect(block).toMatch(/client_max_body_size 8k;/);
    expect(block).toMatch(/limit_req zone=elizaplus_chat/);
    expect(block).toMatch(/proxy_read_timeout \d+s;/);
    expect(block).toContain("resolver 127.0.0.53");            // resolved per request, so a down LM Studio never blocks nginx
    expect(block).toMatch(/set \$lmstudio lmstudio\.example\.lan;/); // by hostname, not an IP
    expect(block).toContain("/v1/chat/completions");
    expect(conf).toContain("limit_req_zone");
  });

  test("the reference nginx config does not publish development files and is not served by the site", async () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "deploy.sh"), "utf8");
    expect(script).toContain("--exclude='deploy'");
  });

  test("the page never builds HTML from text: no innerHTML, outerHTML or document.write", async () => {
    const js = fs.readFileSync(path.join(ROOT, "eliza.js"), "utf8");
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    for (const src of [js, html]) {
      expect(src).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/);
    }
  });
});

test.describe("Inner voice: tuning (angles, rule, no repeats, safety)", () => {
  test("the request says which ELIZA rule fired, or that it fell back", async ({ page }) => {
    const bodies = await withMock(page, reply("ok"));
    await loadPage(page);
    await chat(page, "I need a vacation");
    await expect.poll(() => bodies.length).toBe(1);
    const first = bodies[0].messages[1].content;
    expect(first).toContain("What ELIZA did: ELIZA matched \"i need a vacation\"");
    await chat(page, "banana");
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1].messages[1].content).toContain("no keyword rule matched, so a generic fallback line was used");
  });

  test("each request carries one angle, and the angle can vary", async ({ page }) => {
    const bodies = await withMock(page, reply("ok"));
    await page.addInitScript(() => { window.ELIZAPLUS_ANGLE = 1; });
    await loadPage(page);
    await chat(page, "hello");
    await expect.poll(() => bodies.length).toBe(1);
    const content = bodies[0].messages[1].content;
    expect(content).toContain("Angle for this thought: Name something good or strong");
    expect(content.match(/Angle for this thought:/g).length).toBe(1);
  });

  test("without a fixed angle, the angles are drawn from the whole list over several messages", async ({ page }) => {
    test.setTimeout(30_000);
    const bodies = await withMock(page, reply("ok"));
    await loadPage(page);
    for (let i = 0; i < 10; i++) {
      await chat(page, "message " + i);
      await expect.poll(() => bodies.length).toBe(i + 1);
    }
    const angles = new Set(bodies.map((b) => b.messages[1].content.match(/Angle for this thought: (.*)/)[1]));
    expect(angles.size).toBeGreaterThan(1);
  });

  test("earlier thoughts are sent back with a do-not-repeat instruction (last three only)", async ({ page }) => {
    let n = 0;
    const bodies = await withMock(page, (route) => reply("distinct thought number " + (++n))(route));
    await loadPage(page);
    for (let i = 0; i < 5; i++) {
      await chat(page, "line " + i);
      await expect.poll(() => bodies.length).toBe(i + 1);
      await expect(page.locator(".thought").last()).toContainText("distinct thought number " + (i + 1));
    }
    expect(bodies[0].messages[1].content).not.toContain("Earlier thoughts");
    const last = bodies[4].messages[1].content;
    expect(last).toContain("Earlier thoughts you must not repeat or paraphrase");
    expect(last).toContain("distinct thought number 4");
    expect(last).toContain("distinct thought number 3");
    expect(last).toContain("distinct thought number 2");
    expect(last).not.toContain("distinct thought number 1\n");
  });

  test("a failed request does not add to the earlier-thoughts list", async ({ page }) => {
    let n = 0;
    const bodies = await withMock(page, (route) => (++n === 1 ? route.fulfill({ status: 500, headers: CORS, body: "x" }) : reply("second")(route)));
    await loadPage(page);
    await chat(page, "one");
    await expect.poll(() => bodies.length).toBe(1);
    await page.waitForTimeout(200);
    await chat(page, "two");
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1].messages[1].content).not.toContain("Earlier thoughts");
  });

  for (const sentence of [
    "I want to kill myself",
    "i think about suicide a lot",
    "Sometimes I want to die",
    "I keep wanting to hurt myself",
    "I don't want to be here anymore",
    "thinking about self-harm",
    "I would be better off dead",
  ]) {
    test(`no thought and no request for: "${sentence}"`, async ({ page }) => {
      const bodies = await withMock(page, reply("a wry remark"));
      await loadPage(page);
      const before = await page.locator(".message.eliza").count();
      await chat(page, sentence);
      await page.waitForTimeout(500);
      expect(bodies.length).toBe(0);
      expect(await page.locator(".thought").count()).toBe(0);
      expect(await page.locator(".message.eliza").count()).toBe(before + 1); // ELIZA still answers as usual
    });
  }

  test("everyday phrases that sound similar still get a thought", async ({ page }) => {
    const bodies = await withMock(page, reply("fine"));
    await loadPage(page);
    for (const s of ["I will kill time at the airport", "this homework is killing my evening", "I want to dye my hair"]) {
      const n = bodies.length;
      await chat(page, s);
      await expect.poll(() => bodies.length).toBe(n + 1);
    }
  });

  test("a self-harm message cancels a pending thought for the previous message", async ({ page }) => {
    await withMock(page, async (route) => { await new Promise((r) => setTimeout(r, 1500)); return reply("late")(route); });
    await loadPage(page);
    await chat(page, "I had a rough day");
    await expect(page.locator(".thought.thinking")).toHaveCount(1);
    await chat(page, "I want to die");
    await page.waitForTimeout(1800);
    expect(await page.locator(".thought").count()).toBe(0);
  });
});
