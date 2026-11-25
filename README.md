# Elizaplus

A browser version of Joseph Weizenbaum's 1966 ELIZA (the DOCTOR script) with an optional local-LLM layer. Everything runs in the page; the only server pieces are static files and a small proxy to a language model you host yourself.

- **ELIZA** answers with the classic pattern-matching script (based on the original DOCTOR script; see `NOTICE.md`).
- **Inner voice** (on by default): a second, private thought line shown beside each reply, written by a local model.
- **Elizaplus** (header switch): the model answers instead of the script. Replies stream in and are typed out at a selectable pace (slow / normal / fast). Crisis wording is never sent to the model; it gets a fixed reply pointing to the 988 Suicide & Crisis Lifeline.
- **Input box**: one line at rest, it grows a line at a time as you type or wrap (up to 4 lines, then it scrolls inside itself) and shrinks back after you send. **Enter** sends, **Shift+Enter** starts a new line.

ELIZA is a program, not a therapist, and Elizaplus is a language model that can be wrong. Do not rely on either for advice.

Nothing is stored in the browser. With the inner voice or Elizaplus on, messages go to the model behind your proxy; run it somewhere you trust.

## Run it

Plain ELIZA needs nothing but a static file server:

```bash
npx http-server . -p 8080
```

For the inner voice and Elizaplus the page POSTs OpenAI-style chat requests (`/v1/chat/completions` format, streaming supported) to **`/api/chat` on its own origin**. Point that path at any compatible server, for example [LM Studio](https://lmstudio.ai/) or llama.cpp's server. `deploy/nginx-elizaplus.conf` is a reference nginx setup: POST only, 8 KB body limit, rate limit, short timeouts, no buffering. The model name is set in `eliza.js` (`INNER_VOICE.model`, currently `google/gemma-4-26b-a4b-qat`, run with reasoning off); change it to whatever your server has loaded. If `/api/chat` is missing (404/405) the page falls back to plain ELIZA and hides the switches.

Put your own security headers in front of it (the live smoke test expects `nosniff`, `X-Frame-Options: DENY`, a strict CSP with no inline scripts, and so on); the page uses only same-origin scripts.

## Tests

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

The suite uses Playwright with fake model endpoints, so no LLM is needed. `npm run smoke` runs a few checks against a deployed copy when you set `ELIZAPLUS_URL`.

`.gitlab-ci.yml` and `scripts/deploy.sh` are the author's own pipeline (test on every push, rsync deploy from `main` to one web root); adapt or ignore them.

## Credits and license

MIT licensed, see `LICENSE`. ELIZA and the DOCTOR script are by Joseph Weizenbaum; `NOTICE.md` has the full credits and third-party licenses. The base project is [mamorrow1957/eliza](https://github.com/mamorrow1957/eliza).
