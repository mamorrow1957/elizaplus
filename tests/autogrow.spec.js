// @ts-check
// Auto-growing input box (#144): one line at rest, grows a line at a time up to 4 lines, then scrolls
// inside the box; shrinks back to one line after sending; Shift+Enter adds a line, Enter sends.
const { test, expect } = require("@playwright/test");
const path = require("path");
const PAGE_URL = "file://" + path.resolve(__dirname, "..", "index.html");

async function load(page) {
  await page.goto(PAGE_URL);
  await expect(page.locator(".message.eliza")).toHaveCount(1, { timeout: 8000 });
}
const heightOf = (page) => page.locator("#user-input").evaluate((el) => el.getBoundingClientRect().height);

test.describe("auto-growing input", () => {
  test("starts at one line, grows per line up to 4, then scrolls inside", async ({ page }) => {
    await load(page);
    const box = page.locator("#user-input");
    const h1 = await heightOf(page);
    const heights = [h1];
    for (let n = 2; n <= 6; n++) {
      await box.fill(Array.from({ length: n }, (_, i) => "line " + (i + 1)).join("\n"));
      heights.push(await heightOf(page));
    }
    const step = heights[1] - heights[0];
    expect(step).toBeGreaterThan(10);
    expect(heights[1]).toBeCloseTo(heights[0] + step, 0);
    expect(heights[2]).toBeCloseTo(heights[0] + 2 * step, 0);
    expect(heights[3]).toBeCloseTo(heights[0] + 3 * step, 0);   // 4 lines
    expect(heights[4]).toBeCloseTo(heights[3], 0);              // 5 lines: capped
    expect(heights[5]).toBeCloseTo(heights[3], 0);              // 6 lines: capped
    expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await box.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  });

  test("long text wraps and grows the box", async ({ page }) => {
    await load(page);
    const h1 = await heightOf(page);
    await page.locator("#user-input").fill("word ".repeat(80));
    expect(await heightOf(page)).toBeGreaterThan(h1 + 10);
  });

  test("Enter sends and the box shrinks back to one line", async ({ page }) => {
    await load(page);
    const box = page.locator("#user-input");
    const h1 = await heightOf(page);
    await box.fill("first line\nsecond line\nthird line");
    expect(await heightOf(page)).toBeGreaterThan(h1 + 10);
    await box.press("Enter");
    await expect(box).toHaveValue("");
    expect(await heightOf(page)).toBeCloseTo(h1, 0);
    await expect(page.locator(".message.user .text").last()).toContainText("second line");
  });

  test("Shift+Enter adds a line instead of sending", async ({ page }) => {
    await load(page);
    const box = page.locator("#user-input");
    await box.click();
    await page.keyboard.type("hello");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("world");
    await expect(box).toHaveValue("hello\nworld");
    await expect(page.locator(".message.user")).toHaveCount(0);
  });

  test("chat window stays usable and scrollable while the box is tall", async ({ page }) => {
    await load(page);
    const chat = page.locator("#chat-window");
    const before = await chat.evaluate((el) => el.clientHeight);
    await page.locator("#user-input").fill("a\nb\nc\nd\ne");
    const after = await chat.evaluate((el) => el.clientHeight);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(100);
    expect(await chat.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  });

  test("the padding around the text stays the same when the text scrolls (frame vs text area)", async ({ page }) => {
    await load(page);
    const gap = () => page.evaluate(() => {
      const f = document.getElementById("input-box").getBoundingClientRect();
      const t = document.getElementById("user-input").getBoundingClientRect();
      return { top: Math.round(t.top - f.top), bottom: Math.round(f.bottom - t.bottom) };
    });
    const rest = await gap();
    expect(rest.top).toBeGreaterThanOrEqual(10);
    expect(rest.bottom).toBeGreaterThanOrEqual(10);
    await page.locator("#user-input").fill(Array.from({ length: 9 }, (_, i) => "line " + (i + 1)).join("\n"));
    expect(await gap()).toEqual(rest);            // 9 lines: box capped at 4, text scrolling inside
    // the caret line (the last one) is fully visible above the bottom padding
    const visible = await page.locator("#user-input").evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
    expect(visible).toBe(true);
  });

  test("clicking the padding of the frame puts the cursor in the box", async ({ page }) => {
    await load(page);
    await page.locator("#chat-window").click();   // move focus away
    await page.locator("#input-box").click({ position: { x: 3, y: 3 } });
    await expect(page.locator("#user-input")).toBeFocused();
  });
});
