// Launch check for the public deployment (elizaplus.org): read-only HTTP probes through Cloudflare.
// Skipped unless ELIZAPLUS_LAUNCH_CHECK=1 (it talks to the real public sites, so it is not part of CI).
//   ELIZAPLUS_LAUNCH_CHECK=1 npx playwright test tests/public-launch.spec.js
// Optional overrides: ELIZAPLUS_SPLASH_URL, ELIZAPLUS_APP_URL, ELIZAPLUS_LOGIN_URL.
const { test, expect } = require("@playwright/test");

const SPLASH = process.env.ELIZAPLUS_SPLASH_URL || "https://elizaplus.org";
const APP = process.env.ELIZAPLUS_APP_URL || "https://app.elizaplus.org";
const LOGIN = process.env.ELIZAPLUS_LOGIN_URL || "https://login.elizaplus.org";
const probe = { maxRedirects: 0, timeout: 20000 };

test.describe("Public launch (live)", () => {
  test.skip(process.env.ELIZAPLUS_LAUNCH_CHECK !== "1", "set ELIZAPLUS_LAUNCH_CHECK=1 to probe the live sites");

  test("splash page is up with security headers, images and an HTTPS redirect", async ({ request }) => {
    const res = await request.get(SPLASH + "/", probe);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("A hobby project by Michael Morrow");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toContain("default-src 'none'");
    expect(h["strict-transport-security"]).toBeTruthy();
    for (const p of ["/style.css", "/img/phone.png", "/img/classic-inner-voice.png", "/img/elizaplus-replies.png", "/img/growing-input.png"]) {
      expect((await request.get(SPLASH + p, probe)).status(), p).toBe(200);
    }
    const http = await request.get(SPLASH.replace("https://", "http://") + "/", probe);
    expect([301, 308]).toContain(http.status());
    expect(http.headers()["location"]).toMatch(/^https:\/\//);
  });

  test("the splash page never serves repository or development files", async ({ request }) => {
    for (const p of ["/README.md", "/package.json", "/guard/guard.js", "/deploy/nginx-elizaplus.conf", "/.git/config", "/scripts/deploy.sh", "/tests/splash.spec.js"]) {
      expect((await request.get(SPLASH + p, probe)).status(), p).toBe(404);
    }
  });

  test("the app sends anonymous visitors to the Authentik sign-in, never to the chat", async ({ request }) => {
    const res = await request.get(APP + "/", probe);
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toContain("/outpost.goauthentik.io/start");
    expect(await res.text()).not.toContain("DOCTOR");
  });

  test("the AI endpoint is unreachable without a login", async ({ request }) => {
    const res = await request.post(APP + "/api/chat", { ...probe, data: { model: "x", messages: [{ role: "user", content: "hi" }] } });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toContain("/outpost.goauthentik.io/start");
  });

  test("the sign-in site is reachable but its admin pages are blocked from the internet", async ({ request }) => {
    const login = await request.get(LOGIN + "/", probe);
    expect(login.status()).toBe(302);
    expect(login.headers()["location"]).toContain("/flows/-/default/authentication/");
    expect((await request.get(LOGIN + "/if/admin/", probe)).status()).toBe(403);
  });

  test("the rate-limited flow API still answers a normal single request", async ({ request }) => {
    const res = await request.get(LOGIN + "/api/v3/flows/executor/default-authentication-flow/", probe);
    expect(res.status()).toBe(200);
  });
});
