// Makes the screenshots for the splash page (site/img/*.png) from the real page with a mocked model.
// Sample conversations written for the purpose; nothing here comes from a real chat or a real model.
// Usage: node scripts/make-splash-screenshots.js   (needs @playwright/test and a Chromium install)
const { chromium } = require("@playwright/test");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "site", "img");
const PAGE_URL = "file://" + path.join(ROOT, "index.html");
const MOCK = "http://innervoice.test/api/chat";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

const THOUGHTS = [
  "They are worried about their job. It may help to find out what exactly feels at risk before offering any comfort.",
  "Their mother cares enough to say something. That could be a source of support worth exploring gently.",
  "A small step might help here, like writing down the one thing that matters most this week.",
];
const PLUS_REPLY = "That sounds stressful. What part of it feels heaviest right now?";

async function open(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  let n = 0;
  await page.addInitScript((url) => { window.ELIZAPLUS_ENDPOINT = url; }, MOCK);
  await page.route(MOCK, async (route, request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(request.postData() || "{}");
    if (body.stream) {
      const chunk = (t) => "data: " + JSON.stringify({ choices: [{ delta: { content: t } }] }) + "\n\n";
      return route.fulfill({ status: 200, headers: CORS, contentType: "text/event-stream", body: chunk(PLUS_REPLY) + "data: [DONE]\n\n" });
    }
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: THOUGHTS[n++ % THOUGHTS.length] } }] }) });
  });
  await page.goto(PAGE_URL);
  await page.waitForSelector(".message.eliza");
  await page.addStyleTag({ content: "#last-updated{visibility:hidden}" });   // no build timestamp in marketing shots
  return { ctx, page };
}
async function say(page, text, thoughts) {
  const before = await page.locator(".message.eliza").count();
  await page.fill("#user-input", text);
  await page.press("#user-input", "Enter");
  await page.waitForFunction((b) => document.querySelectorAll(".message.eliza").length > b, before, { timeout: 15000 });
  if (thoughts) await page.waitForFunction((k) => document.querySelectorAll(".thought:not(.thinking)").length >= k, thoughts, { timeout: 15000 });
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch();
  {   // 1. classic + inner voice
    const { ctx, page } = await open(browser, { width: 900, height: 720 });
    await say(page, "I am worried about my job", 1);
    await say(page, "My mother keeps telling me to take a break", 2);
    await page.screenshot({ path: path.join(OUT, "classic-inner-voice.png") });
    await ctx.close();
  }
  {   // 2. Elizaplus answers
    const { ctx, page } = await open(browser, { width: 900, height: 720 });
    await page.click("#mode-toggle");
    await page.waitForTimeout(500);
    await say(page, "I am worried about my job", 0);
    await page.waitForFunction((t) => document.body.innerText.includes(t), PLUS_REPLY.slice(0, 20), { timeout: 20000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, "elizaplus-replies.png") });
    await ctx.close();
  }
  {   // 3. growing input box
    const { ctx, page } = await open(browser, { width: 900, height: 720 });
    await say(page, "I am worried about my job", 1);
    await page.fill("#user-input", "Here is a longer thought that I want to get down properly.\nIt takes a few lines to say.\nThe box grows a line at a time\nand scrolls after the fourth.");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "growing-input.png") });
    await ctx.close();
  }
  {   // 4. phone
    const { ctx, page } = await open(browser, { width: 390, height: 780 });
    await say(page, "I am worried about my job", 1);
    await page.screenshot({ path: path.join(OUT, "phone.png") });
    await ctx.close();
  }
  await browser.close();
  console.log("screenshots written to", OUT);
})().catch((e) => { console.error(e.message); process.exit(1); });
