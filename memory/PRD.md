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
- **Total findings:** ~30 (10 P0 critical security, 7 P1 functional, 12 P2 code quality)
- **Auto-fixed:** All P0, all major P1, most P2 lint
- **Reports created:** `/app/AUDIT_REPORT.md`, `/app/FIXES_APPLIED.md`

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
