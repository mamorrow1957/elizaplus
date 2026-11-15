// @ts-check
// Smoke test of a DEPLOYED elizaplus (nginx + proxy + model). Skipped unless ELIZAPLUS_URL is set, so
// normal runs and CI never depend on the live site or on LM Studio being up. Run it by hand with:
//   ELIZAPLUS_URL=https://your-elizaplus.example.com npm run smoke
const { test, expect } = require("@playwright/test");

const BASE = process.env.ELIZAPLUS_URL || "";
test.describe("Live elizaplus smoke test", () => {
  test.skip(!BASE, "set ELIZAPLUS_URL to run against a deployed site");

  test("the page loads with the right title and security-relevant files stay private", async ({ request }) => {
    const home = await request.get(BASE + "/");
    expect(home.status()).toBe(200);
    expect(await home.text()).toContain("Elizaplus");
    for (const p of ["/scripts/deploy.sh", "/.gitlab-ci.yml", "/.gitignore", "/LICENSE", "/README.md", "/package.json", "/deploy/nginx-elizaplus.conf", "/.git/config"]) {
      expect((await request.get(BASE + p)).status(), p).toBe(404);
    }
  });

  test("the security headers and the strict CSP are sent (set on the NPM proxy host, not by this repo)", async ({ request }) => {
    for (const url of [BASE + "/", BASE + "/eliza.js", BASE + "/api/chat"]) {
      const h = (await request.get(url)).headers();
      expect(h["x-content-type-options"], url).toBe("nosniff");
      expect(h["x-frame-options"], url).toBe("DENY");
      expect(h["referrer-policy"], url).toBe("no-referrer");
      expect(h["permissions-policy"], url).toContain("microphone=()");
      const csp = h["content-security-policy"] || "";
      for (const part of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) expect(csp, url).toContain(part);
      expect(csp, url).not.toContain("unsafe-eval");
      expect(csp.match(/script-src[^;]*/)[0], url).not.toContain("unsafe-inline");   // scripts stay external only
    }
  });

  test("the chat endpoint refuses GET and oversize bodies", async ({ request }) => {
    expect((await request.get(BASE + "/api/chat")).status()).toBe(403);
    const big = await request.post(BASE + "/api/chat", { data: { x: "a".repeat(20000) } });
    expect(big.status()).toBe(413);
  });

  test("the chat endpoint returns a thought, or the model is simply unavailable", async ({ request }) => {
    const res = await request.post(BASE + "/api/chat", {
      timeout: 25_000,
      data: {
        model: "google/gemma-4-26b-a4b-qat",
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        max_tokens: 20, reasoning_effort: "none",
      },
    });
    test.skip([502, 503, 504].includes(res.status()), "LM Studio not reachable from the proxy right now");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(typeof data.choices[0].message.content).toBe("string");
    expect(data.choices[0].message.content.length).toBeGreaterThan(0);
  });

  // Optional: if a plain-ELIZA site shares the server, set ELIZA_PLAIN_URL to check it exposes no chat proxy.
  test("a plain ELIZA site has no chat endpoint", async ({ request }) => {
    test.skip(!process.env.ELIZA_PLAIN_URL, "set ELIZA_PLAIN_URL to check a plain ELIZA site");
    const res = await request.get(process.env.ELIZA_PLAIN_URL + "/api/chat");
    expect(res.status()).toBe(404);
  });
});
