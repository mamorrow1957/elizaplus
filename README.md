# Elizaplus

A browser version of Joseph Weizenbaum's 1966 ELIZA (the DOCTOR script) with an optional local-LLM layer. Everything runs in the page; the only server pieces are static files and a small proxy to a language model you host yourself.

- **ELIZA** answers with the classic pattern-matching script (based on the original DOCTOR script; see `NOTICE.md`).
- **Inner voice** (on by default): a second, private thought line shown beside each reply, written by a local model.
- **Elizaplus** (header switch): the model answers instead of the script. Replies stream in and are typed out at a selectable pace (slow / normal / fast). Crisis wording is never sent to the model; it gets a fixed reply pointing to the 988 Suicide & Crisis Lifeline.
- **Input box**: one line at rest, it grows a line at a time as you type or wrap (up to 4 lines, then it scrolls inside itself) and shrinks back after you send. **Enter** sends, **Shift+Enter** starts a new line.

ELIZA is a program, not a therapist, and Elizaplus is a language model that can be wrong. Do not rely on either for advice.

The author's hosted copy is at https://elizaplus.org (invite-only; its front page links back to this repository). The code here is what runs it.

Nothing is stored in the browser. With the inner voice or Elizaplus on, messages go to the model behind your proxy; run it somewhere you trust.

## Run it

Plain ELIZA needs nothing but a static file server:

```bash
npx http-server . -p 8080
```

For the inner voice and Elizaplus the page POSTs OpenAI-style chat requests (`/v1/chat/completions` format, streaming supported) to **`/api/chat` on its own origin**. Point that path at any compatible server, for example [LM Studio](https://lmstudio.ai/) or llama.cpp's server. `deploy/nginx-elizaplus.conf` is a reference nginx setup: POST only, 8 KB body limit, rate limit, short timeouts, no buffering. The model name is set in `eliza.js` (`INNER_VOICE.model`, currently `google/gemma-4-26b-a4b-qat`, run with reasoning off); change it to whatever your server has loaded. If `/api/chat` is missing (404/405) the page falls back to plain ELIZA and hides the switches.

**Sites with accounts (optional guard).** `guard/guard.js` is a small dependency-free Node service you can put between nginx and the model server. It accepts only one fixed request shape (your model name, whitelisted fields, a reply-length cap), limits each signed-in user's request rate, limits how many requests the model serves at once (extras wait briefly in a queue, then get HTTP 429), and never logs message text. nginx tells it who the user is through a header that only your login proxy may set; see `deploy/nginx-elizaplus-guarded.conf`, `deploy/elizaplus-guard.service` and `deploy/elizaplus-guard.env.example`. `scripts/setup-guard-host.sh` is a one-time setup for Ubuntu (Node.js 26 LTS). Nothing in the guard is needed for a private site.

Put your own security headers in front of it (the live smoke test expects `nosniff`, `X-Frame-Options: DENY`, a strict CSP with no inline scripts, and so on); the page uses only same-origin scripts.

## How the pieces fit (sites with accounts)

The page itself needs no accounts. For a site with invited users the author puts a login layer in front and the guard behind it:

```text
visitor -> Cloudflare -> reverse proxy with forward auth (Authentik) -> nginx -> guard -> model server
                          signed-in users only                          static   /api/chat   LM Studio, llama.cpp, ...
                                                                        files
```

- **Login layer** (not part of this repo): any reverse proxy plus an identity provider. The proxy tells nginx who is signed in through a header (`X-Auth-User`) that only the proxy may set; `deploy/nginx-elizaplus-guarded.conf` shows how nginx enforces that. `deploy/authentik/` holds the author's green-and-black Authentik branding as a reference.
- **nginx** serves the static files and forwards only `POST /api/chat`, to the guard on loopback.
- **Guard** (`guard/`): fixed request shape, reply-length cap, per-user rate limit, limited concurrency, and no message text in its logs.
- **Splash page** (`site/`): a separate static front page for the bare domain, with its own nginx site (`deploy/nginx-elizaplus-splash.conf`).
- **Private use needs none of this:** a LAN-only site can use `deploy/nginx-elizaplus.conf` and no guard.

## Splash page

`site/` is a separate static landing page (retro look, no scripts, no outside requests) with a description, screenshots, a Log in button and a link to this repository; serve it from its own web root. `node scripts/make-splash-screenshots.js` regenerates the screenshots from the real page with a mocked model (sample conversations written for the purpose). The deploy script never copies `site/` into the app's web root.

## Tests

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

`ELIZAPLUS_LAUNCH_CHECK=1 npx playwright test tests/public-launch.spec.js` probes a live public deployment read-only (override the URLs with `ELIZAPLUS_SPLASH_URL`, `ELIZAPLUS_APP_URL`, `ELIZAPLUS_LOGIN_URL`).

`npm run test:guard` runs the guard's unit tests (Node's built-in runner, no install needed).

The suite uses Playwright with fake model endpoints, so no LLM is needed. `npm run smoke` runs a few checks against a deployed copy when you set `ELIZAPLUS_URL`.

`.gitlab-ci.yml` and `scripts/deploy.sh` are the author's own pipeline (test on every push; on `main`, rsync the app to its web root, `site/` to the splash page's own web root, and refresh the guard where it is installed); adapt or ignore them.

## Credits and license

MIT licensed, see `LICENSE`. ELIZA and the DOCTOR script are by Joseph Weizenbaum; `NOTICE.md` has the full credits and third-party licenses. The base project is [mamorrow1957/eliza](https://github.com/mamorrow1957/eliza).
