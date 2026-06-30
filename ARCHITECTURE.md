# Architecture

## Overview

BahAI üç əsas laydan ibarətdir:

1. `frontend`
   React/Vite UI. Chat state, approvals, checkpoint modal, settings, runtime artifact rendering.
2. `backend`
   Express API. Auth, project/file routes, orchestration, LLM provider routing, browser tools, GUI fast-path logic.
3. `electron`
   Desktop shell. Local backend bootstrap, app window, OAuth callback bridge, native directory picker.

## Backend xəritə

- `backend/index.js`
  əsas API entrypoint. Hələ monolitdir, amma bəzi hissələr modullaşdırılıb.
- `backend/auth.js`
  login/register/refresh/config/me
- `backend/db.js`
  PostgreSQL init və query helper
- `backend/browserSession.js`
  Playwright/Chrome/CDP session lifecycle
- `backend/gui/runtime.js`
  screenshot və browser-backed GUI action execution
- `backend/gui/provider.js`
  GUI grounding, action assessment
- `backend/gui/agent.js`
  observe/act/reflect loop
- `backend/gui/requests.js`
  GUI request classifier-ləri və browser_open arg builder
- `backend/gui/fastpath.js`
  GUI self-test, Wix login checkpoint, login resume SSE flow-ları
- `backend/orchestrator/*`
  workflow resolver, manager router, role prompts, run manager, artifact helpers
- `backend/tools/*`
  tool registry və role/workflow tool profile mapping

## Frontend xəritə

- `frontend/src/hooks/useChat.ts`
  əsas chat runtime state
- `frontend/src/hooks/useAuth.tsx`
  auth state və refresh handling
- `frontend/src/hooks/useSettings.ts`
  local settings persistence
- `frontend/src/components/chat/*`
  chat area, tool cards, ops panel, terminal, preview
- `frontend/src/components/sidebar/SettingsPanel.tsx`
  model/provider/browser settings

## Electron xəritə

- `electron/main.js`
  backend bootstrap, BrowserWindow, auth IPC
- `electron/preload.js`
  renderer-ə təhlükəsiz bridge

## Kritik axınlar

### Chat

`App -> useChat -> frontend/lib/api.ts -> POST /api/chat -> backend/index.js`

### GUI checkpoint

`GUI prompt -> workflow=gui -> backend/gui/requests.js classifier -> backend/gui/fastpath.js -> browser_open / human_checkpoint SSE`

### GUI resume

`Login oldum -> gui fast-path resume -> gui_observe -> assistant guidance`

### Browser lifecycle

`browser_open -> backend/browserSession.js`

- `cdp`: mövcud Chrome-a qoşulur, lazım olsa tələb zamanı Chrome başladır
- `persistent`: real Chrome profilini yeni sessiya ilə açır
- `bundled`: Playwright Chromium fallback

## Cari texniki borclar

1. `backend/index.js` hələ çox böyükdür
2. `frontend/src/hooks/useChat.ts` çox məsuliyyət daşıyır
3. queue/checkpoint/browser integration coverage hələ natamamdır
4. docs kökdə çoxdur, zamanla konsolidasiya lazımdır

## Yaxın roadmap

1. chat route-ları ayrıca modul-lara bölmək
2. queue + human checkpoint integration testlərini artırmaq
3. `useChat` decomposition
4. GUI SEO workflow üçün daha etibarlı observation/action contracts
