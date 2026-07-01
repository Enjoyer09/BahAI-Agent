# BahAI Agent

BahAI desktop-first AI coding agent-dir. Layihə təkcə chat assistant deyil, həm də:

- orchestral multi-role coding flow
- browser-backed GUI agent
- local desktop Electron app
- project memory, approvals, diff preview, terminal və browser artifact-ləri

## Əsas hissələr

- `backend/`
  Express API, auth, orchestration, tools, GUI/browser runtime
- `frontend/`
  React/Vite UI, chat, settings, approvals, runtime artifact görüntüləmə
- `electron/`
  Desktop shell, local backend bootstrap, OAuth callback bridge
- `scripts/`
  local startup, GUI smoke, browser debug yardımcı skriptləri
- `docs/ai/harness/`
  orchestration, workflow və evidence contract sənədləri
- `memory/`
  handoff və audit kontekst faylları

## Lokal start

Desktop app:

```bash
/Users/macbookair/Documents/GitHub/BahAI-Agent/Start_bahAI.command
```

Manual dev:

```bash
npm run start:gui
```

Detached launch:

```bash
npm run launch:gui
```

## Testlər

Backend testlər:

```bash
cd backend
LOCAL_MODE=true npx vitest run
```

Frontend build:

```bash
npm run build --prefix frontend
```

GUI smoke:

```bash
npm run smoke:gui
```

Prod smoke:

```bash
npm run smoke:prod -- --checkpoint
```

Harness contract check:

```bash
npm run check:harness
```

## Vacib qeydlər

- Default behavior-də Chrome artıq app start zamanı avtomatik açılmır.
- GUI sorğusu gələndə CDP mode üçün Chrome lazım olsa tələb zamanı başladılır.
- `LOCAL_MODE=true` desktop development üçündür, hosted deployment üçün deyil.

## Oxuma sırası

1. `ARCHITECTURE.md`
2. `memory/CODE_AGENT_HANDOFF.md`
3. `backend/index.js`
4. `frontend/src/hooks/useChat.ts`

## Digər sənədlər

- `DESKTOP_APP.md`
  desktop istifadə axını və behavior qeydləri
- `GOOGLE_OAUTH_SETUP.md`
  Google OAuth quraşdırması
- `GOOGLE_LOGIN_AZ.md`
  login behavior qeydləri
- `PATCH_NOTES_P1_P2_P3.md`
  əvvəlki inkişaf mərhələlərinin qeydləri
- `AUDIT_REPORT.md`
  əvvəlki audit snapshot-larından biri

Yeni işə başlayan agent və ya developer üçün əsas istiqamət yenə də `README.md` + `ARCHITECTURE.md` + `memory/CODE_AGENT_HANDOFF.md` üçlüyüdür.
