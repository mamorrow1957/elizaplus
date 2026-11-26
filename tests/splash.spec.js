// Splash page (site/index.html): static, public, no scripts, no outside requests, links where they should go.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const URL = "file://" + path.join(SITE, "index.html");
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
const css = fs.readFileSync(path.join(SITE, "style.css"), "utf8");

test.describe("Splash page", () => {
  test("has the headline, the author line, a Log in button and a GitHub link", async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator("h1")).toContainText("ELIZA");
    await expect(page.locator("body")).toContainText("A hobby project by Michael Morrow");
    await expect(page.locator("a.button.primary")).toHaveText("Log in");
    await expect(page.locator("a.button.primary")).toHaveAttribute("href", "https://app.elizaplus.org/");
    await expect(page.locator("a.button", { hasText: "Get the code" })).toHaveAttribute("href", "https://github.com/mamorrow1957/elizaplus");
  });

  test("all screenshots exist and load", async ({ page }) => {
    await page.goto(URL);
    const imgs = page.locator("img");
    expect(await imgs.count()).toBe(4);
    for (const el of await imgs.all()) {
      expect(await el.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
      expect((await el.getAttribute("alt") || "").length).toBeGreaterThan(20);
    }
  });

  test("no scripts, no inline styles, no outside resources", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\sstyle=|\son\w+=/i);
    expect(html).not.toMatch(/(src|href)="https?:\/\/(?!github\.com\/mamorrow1957\/elizaplus|app\.elizaplus\.org)/);
    expect(css).not.toMatch(/url\(|@import/i);
  });

  test("no private names or addresses leak into the page", () => {
    const text = html + css;
    expect(text).not.toMatch(/\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+/);   // no private addresses
    expect(text).not.toMatch(/\.(?:local|lan|internal|home)\b/i);                                  // no internal-only names
    const allowed = new Set(["github.com", "elizaplus.org", "app.elizaplus.org"]);                  // the only hosts the page may mention
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) expect(allowed.has(m[1].toLowerCase()), m[1]).toBe(true);
  });

  test("fits a phone-sized screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(URL);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the deploy script keeps the site folder out of the app docroot", () => {
    expect(fs.readFileSync(path.join(ROOT, "scripts", "deploy.sh"), "utf8")).toContain("--exclude='site'");
  });

  test("the deploy script publishes site/ to its own root, only where that folder exists", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "deploy.sh"), "utf8");
    expect(script).toContain("SITE_DEST=/var/www/elizaplus-site");
    expect(script).toContain('sudo test -d "${SITE_DEST}"');
    expect(script).not.toMatch(/rsync[^\n]*site\/[^\n]*\/var\/www\/elizaplus\/\n/);   // never into the app docroot
  });

  test("the reference nginx site repeats the security headers in every location", () => {
    const conf = fs.readFileSync(path.join(ROOT, "deploy", "nginx-elizaplus-splash.conf"), "utf8");
    const locations = conf.match(/location [^{]+\{[\s\S]*?\n\t\}/g) || [];
    expect(locations.length).toBe(2);
    for (const loc of locations) {
      for (const h of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Content-Security-Policy"]) expect(loc).toContain(h);
    }
    expect(conf).toContain("root /var/www/elizaplus-site;");
  });
});
