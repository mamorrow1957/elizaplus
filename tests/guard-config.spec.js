// Repository checks for the guarded setup (no browser): the reference nginx config, the service unit,
// the setup script and the deploy script must keep the guard safe and keep it out of the public docroot.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test.describe("Guarded setup (reference files)", () => {
  test("nginx sends AI requests to the guard on loopback, POST only, small bodies, unbuffered", () => {
    const conf = read("deploy", "nginx-elizaplus-guarded.conf");
    const loc = conf.match(/location = \/api\/chat \{[\s\S]*?\n\t\}/);
    expect(loc).not.toBeNull();
    const block = loc[0];
    expect(block).toMatch(/limit_except POST \{ deny all; \}/);
    expect(block).toContain("client_max_body_size 8k;");
    expect(block).toContain("proxy_pass http://127.0.0.1:3100/api/chat;");
    expect(block).toContain("proxy_buffering off;");          // streaming needs this
    expect(block).toContain("proxy_set_header X-Auth-User $guard_user;");
    expect(block).not.toContain("lmstudio");                  // the browser path never reaches the model server directly
  });

  test("the user name is trusted only from the login proxy, never from a client", () => {
    const conf = read("deploy", "nginx-elizaplus-guarded.conf");
    expect(conf).toMatch(/geo \$from_login_proxy \{\s*default 0;/);
    expect(conf).toContain('"~^1:(?<name>');                  // only when the flag is 1
    expect(conf).toMatch(/default "lan";/);
    expect(conf).not.toMatch(/proxy_set_header X-Auth-User \$http_x_auth_user/);
  });

  test("the service runs sandboxed, on loopback settings from a file, with no secrets in the repo", () => {
    const unit = read("deploy", "elizaplus-guard.service");
    for (const line of ["DynamicUser=yes", "NoNewPrivileges=yes", "ProtectSystem=strict", "ProtectHome=yes", "EnvironmentFile=/etc/elizaplus-guard.env"]) {
      expect(unit).toContain(line);
    }
    const env = read("deploy", "elizaplus-guard.env.example");
    expect(env).not.toMatch(/GUARD_HOST=/);                   // default stays 127.0.0.1
    expect(env).toContain(".example.lan");                    // by hostname, never a real address or key
    expect(env).not.toMatch(/(API_?KEY|PASSWORD|SECRET|BEARER|ACCESS_TOKEN)\w*=/i);   // no credential settings (GUARD_MAX_TOKENS is a reply-length limit)
  });

  test("the guard defaults to loopback and refuses to start without an upstream and a model", () => {
    const js = read("guard", "guard.js");
    expect(js).toContain('env.GUARD_HOST || "127.0.0.1"');
    expect(js).toContain("GUARD_UPSTREAM is required");
    expect(js).toContain("GUARD_MODEL is required");
    expect(js).not.toMatch(/console\.log\([^)]*(content|messages)/);   // never log message text
  });

  test("the deploy script keeps the guard and site sources out of the docroot and only updates an installed guard", () => {
    const script = read("scripts", "deploy.sh");
    expect(script).toContain("--exclude='guard'");
    expect(script).toContain("--exclude='site'");
    expect(script).toContain("systemctl cat elizaplus-guard.service");   // no-op on hosts without the guard
  });

  test("the one-time setup script needs root, installs Node 26 and does not start without settings", () => {
    const s = read("scripts", "setup-guard-host.sh");
    expect(s).toContain("set -euo pipefail");
    expect(s).toContain("node_26.x");
    expect(s).toContain("/etc/elizaplus-guard.env");
    expect(s).not.toMatch(/rm -rf|\/var\/www\/html/);
  });
});
