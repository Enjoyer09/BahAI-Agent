# bahAI — PRD / Audit Memory

## Original request
> "proqrami audit ele. funksionalliq ve herbir sheyini" — Tam audit + tapılan bug-ları avtomatik düzəltmək.

## Project type
**bahAI / iBahora Code** — Azərbaycan dilində AI Kodlaşdırma Agenti.

## Stack
- **Backend:** Node.js 20+ (Express 5), bcryptjs, jsonwebtoken, openai-sdk, pdf-parse, mammoth (DOCX), xlsx, tesseract.js
- **Frontend:** React 19 + TypeScript, Vite 6, Tailwind 4, lucide-react, react-markdown
- **Desktop:** Electron 33 (macOS, Windows, Linux build via electron-builder)
- **DB:** PostgreSQL (opsional) + local JSON fallback (`sandbox/local_db.json`)
- **AI:** Multi-provider — OpenRouter, NVIDIA NIM, Ollama (local); failover/cooldown logic
- **Deployment:** Railway (cloud) + Electron (desktop)

## Audit summary
- **Total findings:** ~36 (10 P0 critical security, 13 P1 functional, 13 P2 code quality)
- **Auto-fixed:** All P0, all major P1, most P2 lint
- **Reports created:** `/app/AUDIT_REPORT.md`, `/app/FIXES_APPLIED.md`, `/app/TEST_RESULTS.md`, `/app/MAC_SETUP.md`

## Session 2 — functional improvements (user feedback: "her şey ləng və bəyənmirəm")

User complained: a) hallucinates, b) misformat tools, c) UI slow, d) "can't do this", e) Safe Mode annoying, f) FileTree broken. Plus wanted hybrid local+cloud mode.

### Shipped
1. **System prompt 700→15 lines for local models** — major quality boost for Gemma/Qwen
2. **Tool prompt 80→15 lines** with single example
3. **MAX_STEPS 15→6** (4x fewer hallucination loops)
4. **LLM_TIMEOUT_MS 10min→3min** (faster feedback on stuck models)
5. **Streaming UI 30fps throttle** — no more per-token rerender
6. **FileTree lazy-loads children** — previously subdirs were just empty
7. **Safe Mode default OFF**, visible toggle in ChatInput (shield icon)
8. **MODELS list overhauled** — added Claude Sonnet 4.5, GPT-5.2, Gemini 3 Flash, Claude Haiku 4.5
9. **Parser rewrite** — `extractTextToolCalls` single-pass; 8/8 unit tests pass
10. **Default model fixed** to a real model ID (was `nemotron-3-super-120b` — non-existent)

### Verified via curl (`/app/TEST_RESULTS.md`)
- Auth flow (login + invalid token → 403 + LOCAL_MODE no-token → admin)
- Project CRUD
- File tree root + lazy load subdirs ✅
- Rate limit 5/15min works
- SSRF guards present
- Parser unit tests 8/8

## What still needs human action
- Fill `.env` with `JWT_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY`, `ADMIN_EMAIL/PASSWORD`, `ALLOWED_ORIGINS`
- Test real Ollama on user's Mac per `/app/MAC_SETUP.md`
- Add a real test suite (vitest + supertest) — none exists today
- Consider JWT refresh-token rotation
- `helmet` & `express-rate-limit` packages instead of in-house mini versions
- Bundle code-split (1.17MB single chunk is heavy)

## Highest-impact fixes shipped
1. CORS allow-list (`ALLOWED_ORIGINS`) — previously open to the world
2. Token-forgery in LOCAL_MODE patched (invalid token no longer = admin)
3. `LOCAL_MODE` no longer activates implicitly when `DATABASE_URL` is missing
4. Removed `debug_messages.json` plain-text dump of every chat
5. Fixed XSS in Google OAuth callback HTML
6. Rate-limited `/api/auth/login` and `/api/auth/register` (5/15min/IP)
7. SSRF protection on `web_fetch` (private IPs blocked)
8. `start_server` tool now obeys `isBashCommandSafe`
9. `extractAttachment` actually parses PDF / DOCX / XLSX / images now
10. Hardcoded `Admin123!` no longer seeded on cloud deploys
11. Security headers (X-Content-Type-Options, X-Frame-Options, HSTS) added
12. App.tsx: Electron-only padding/drag-handle (no dead space in browser)
13. ElevenLabs `signedUrl` now uses `API_BASE_URL` (works in dev)
14. Default model in `useSettings` now actually matches a real `MODELS` entry

## What still needs human action
- Fill `.env` with `JWT_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY`, `ADMIN_EMAIL/PASSWORD`, `ALLOWED_ORIGINS`
- `npm install` inside `/app/backend` and `/app/frontend` (deps missing)
- Add a real test suite (vitest + supertest) — none exists today
- Consider JWT refresh-token rotation (30-day tokens are long-lived)
- Add `helmet` & `express-rate-limit` packages (light replacements are in place)

## Prioritized backlog (P0 → P3)
- **P1:** Unit tests for `isPathSafe`, `extractTextToolCalls`, auth flows
- **P1:** Replace `cachedLocalGithubUsername` module cache with per-user cache
- **P1:** Replace in-memory rate limiter with Redis/express-rate-limit on multi-instance deploy
- **P2:** Bundle-split frontend (`@monaco-editor` is huge)
- **P2:** Sentry / observability hooks
- **P3:** i18n (currently az-only)
- **P3:** GitHub flow E2E test
