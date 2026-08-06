# BahAI — Production Deployment Guide

Production-ready deployment checklist for Railway (or any container host).

## 1. Required environment variables

```env
NODE_ENV=production
PORT=3001

# Security — no defaults allowed
JWT_SECRET=<min-32-char-random-string>          # backend/auth.js throws if missing
GITHUB_TOKEN_SECRET=<separate-random-string>    # optional; falls back to JWT_SECRET
ALLOWED_ORIGINS=https://your-app.up.railway.app # cross-origin browser requests

# Database (PostgreSQL)
DATABASE_URL=postgres://user:pass@host:5432/bahai

# Admin bootstrap
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<strong-password>

# AI providers
OPENAI_API_KEY=<key>
OPENAI_BASE_URL=https://api.freemodel.dev/v1   # or https://openrouter.ai/api/v1
OPENAI_MODEL=gpt-5.5
# OPENROUTER_API_KEY=<sk-or-...>               # optional free-model fallback
# OPENROUTER_FALLBACK_MODELS='deepseek/deepseek-v4-flash:free,qwen/qwen3-coder:free'
# OMNIROUTE_ENABLED=true                       # optional gateway control plane
# OMNIROUTE_BASE_URL=https://your-omniroute-host/v1
# OMNIROUTE_API_KEY=<key>
```

## 2. Forbidden in production

The backend refuses to start with either of these:

- `LOCAL_MODE=true` — silently turns the deployment into an unauthenticated
  admin server (guard: `backend/index.js`).
- `DEMO_LOGIN_ENABLED=true` — gives everyone a one-click admin login
  (guard: `backend/index.js`).
- Missing `JWT_SECRET` — throws at startup (guard: `backend/auth.js:13`).

Keep `DISABLE_CSP=false` and `ENABLE_SERVER_TOOLS=false` unless you explicitly
need server-side workspace tools for non-admin users.

## 3. Railway deploy

1. Push to GitHub and connect the repo in Railway (`New Project → Deploy from
   GitHub`). The root `Dockerfile` is auto-detected (multi-stage frontend
   build → Node runtime).
2. Add a PostgreSQL plugin and copy its `DATABASE_URL` into the service env.
3. Set all required env vars from section 1 in Railway dashboard. Secrets
   (`JWT_SECRET`, API keys, `DB_PASSWORD`) should be stored as Railway
   variables — never in the repo.
4. `ALLOWED_ORIGINS` must include the final public origin (e.g.
   `https://your-app.up.railway.app`). With no value, production CORS is
   fail-closed: cross-origin browser requests get no CORS headers
   (`backend/index.js`), same-origin still works.
5. Health check: Dockerfile probes `/api/auth/config` — Railway can use the
   container healthcheck automatically.

## 4. Post-deploy smoke

```bash
node scripts/prod-smoke.js            # basic endpoint + auth flow
node scripts/prod-smoke.js --matrix   # multi-provider matrix
node scripts/provider-failover-smoke.js --remote
```

## 5. Operations checklist

- **Backups**: PostgreSQL plugin snapshots; verify restore at least once.
- **Schema**: tables are created idempotently at startup (`backend/db.js`).
  For real schema changes, add explicit migrations before shipping.
- **Logs**: server logs contain provider failover telemetry
  (`[PROVIDER]` lines). Attach Railway log drain or an external log service
  before going public.
- **Rate limits**: `/api/chat` is capped at 30 req/min per IP in non-local
  mode (`CHAT_RATE_MAX`); adjust per traffic expectations.
- **Secrets rotation**: rotate `JWT_SECRET`/`GITHUB_TOKEN_SECRET` only with a
  maintenance window — changing them invalidates sessions and makes stored
  GitHub tokens undecryptable.

## 6. Security checklist

- [ ] `.env` and `.freebuff/*.db` are git-ignored; no local DB in repo history
- [ ] `JWT_SECRET` + `GITHUB_TOKEN_SECRET` set and strong
- [ ] `ALLOWED_ORIGINS` set to the public origin(s)
- [ ] `LOCAL_MODE=false`, `DEMO_LOGIN_ENABLED=false`, `DISABLE_CSP=false`
- [ ] HTTPS enforced (Railway does this by default)
- [ ] Admin account created and default password changed
- [ ] CI green: `cd backend && npm test`, frontend `tsc --noEmit` + build
