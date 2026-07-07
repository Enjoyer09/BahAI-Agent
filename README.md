# BahAI Agent

BahAI iki məhsul xətti üzrə formalaşır:

- `BahAI Cloud`
  hosted web təcrübəsi, hazırda Railway-də işləyir və chat-first cloud assistant kimi mövqelənir
- `BahAI Desktop`
  Electron app, code-agent-first təcrübədir və `Cloud / Local` execution source ilə işləyir

Layihə iki fərqli məhsul səthi üzərində qurulur:

- `BahAI Cloud`
  sadə, chat-first hosted web təcrübəsi
- `BahAI Desktop`
  local/cloud source seçimi olan daha güclü code-agent desktop təcrübəsi

Desktop tərəfdə əlavə olaraq:

- orchestral multi-role coding flow
- browser-backed GUI agent
- local desktop Electron app
- project memory, approvals, diff preview, terminal və browser artifact-ləri

## Məhsul istiqaməti

- Web səthində model/provider seçimi gizlidir və UI chat-first saxlanılır
- Desktop-da user yalnız execution source seçir: `Cloud` və ya `Local`
- Cloud routing üçün arxa planda provider orchestration istifadə olunur
- Local routing üçün desktop local model router əsas rol oynayır

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

Desktop smoke:

```bash
npm run smoke:desktop
```

Electron smoke:

```bash
npm run smoke:electron
```

Prod smoke:

```bash
npm run smoke:prod -- --checkpoint
```

Prod checkpoint smoke shortcut:

```bash
npm run smoke:prod:checkpoint
```

Harness contract check:

```bash
npm run check:harness
```

## Vacib qeydlər

- Default behavior-də Chrome artıq app start zamanı avtomatik açılmır.
- GUI sorğusu gələndə CDP mode üçün Chrome lazım olsa tələb zamanı başladılır.
- `LOCAL_MODE=true` desktop development üçündür, hosted deployment üçün deyil.
- `smoke:desktop` local backend və desktop-emulated shell üçün nəzərdə tutulub; default olaraq `http://127.0.0.1:3001` yoxlayır.
- `smoke:electron` real Electron app qabığını açır və desktop shell + settings + chat axınını yoxlayır.
- `smoke:prod` web cloud shell-in desktop surface göstərmədiyini də assert edir.
- `smoke:prod:checkpoint` hosted GUI login-checkpoint axınını da yoxlayır.

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

## Freebuff auto-start

BahAI acilanda Freebuff2API proxy-ni arxa fonda qaldirmaq ucun startup script bunu avtomatik yoxlayir.

Lazim olan env:

- `FREEBUFF_AUTO_START=true`
- `FREEBUFF_BASE_URL=http://127.0.0.1:8080/v1`
- `FREEBUFF_START_CMD="..."`  - Freebuff2API-ni qaldiran komanda

Qeyd:

- Bu deyerleri `.env` ve ya `.env.local` daxilinde saxlaya bilersen; startup script onlarin ikisini de avtomatik oxuyur.
- Proxy artiq isleyirse BahAI ona toxunmur.
- `FREEBUFF_START_CMD` verilmeyibse BahAI normal acilir, sadece Freebuff skip olunur.
- Log fayli adeten `${TMPDIR:-/tmp}/bahai-agent/freebuff.log` olur.

Yeni işə başlayan agent və ya developer üçün əsas istiqamət yenə də `README.md` + `ARCHITECTURE.md` + `memory/CODE_AGENT_HANDOFF.md` üçlüyüdür.
