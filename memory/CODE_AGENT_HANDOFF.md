# Code Agent Handoff

Date: 2026-06-26
Repo: `/Users/macbookair/Documents/GitHub/BahAI-Agent`

## Mission

BahAI is being split into a dual-product shape:

- `BahAI Cloud`: hosted web, chat-first, cloud-only routing
- `BahAI Desktop`: desktop code agent with `Cloud / Local` execution choice

The user prefers direct implementation and usually asks for the strongest next step. Keep answers concise, implement first when the direction is clear, and avoid fake audit/findings without reading files.

## Current Status

Product split work is now in progress, not just planned.

- Frontend settings/chat surface now carries `productMode` and `executionMode`.
- Web UI presents itself as `BahAI Cloud`.
- Desktop UI presents itself as `BahAI Desktop` and exposes `Cloud / Local`.
- Chat input model picker was removed from the main surface.
- Web settings are being simplified toward chat-first behavior; desktop retains advanced execution and GUI controls.
- Backend provider routing now respects:
  - `web_chat` => cloud-only provider candidates
  - `desktop_code + local` => local-only Ollama-style candidates
  - `desktop_code + cloud` => cloud-oriented candidates
- Web requests attempting `gui`, `computer_use`, or `seo_gui` are downgraded to a safer chat workflow path.

P0/P1 orchestration hardening is mostly complete. BahAI now has:

- Manager-style routing so not every role answers every question.
- Workflow resolver for `quick`, `default`, `gui`, `thorough`, and `review-only`.
- Tool registry and workflow-based tool profiles.
- Role prompt extraction and orchestration state events.
- Repo-aware validation, reviewer enforcement, retry policy, token/tool budget discipline.
- Diff preview and approval-aware execution flow.
- Browser automation tools and frontend rendering for screenshots/artifacts.
- Runtime artifact structuring for browser and terminal results.
- GUI v0 modules inspired by Agent-S: observation, action, reflection.

## Important Files

- Backend entrypoint: `backend/index.js`
- Tool registry: `backend/tools/registry.js`
- Tool profiles: `backend/tools/profiles.js`
- Browser runtime: `backend/browserSession.js`
- GUI runtime: `backend/gui/runtime.js`
- GUI provider/grounding: `backend/gui/provider.js`
- GUI agent loop: `backend/gui/agent.js`
- Manager router: `backend/orchestrator/managerRouter.js`
- Workflow resolver: `backend/orchestrator/workflowResolver.js`
- Role prompts: `backend/orchestrator/rolePrompts.js`
- Run manager: `backend/orchestrator/runManager.js`
- Artifact helpers: `backend/orchestrator/executionArtifact.js`
- Frontend chat hook: `frontend/src/hooks/useChat.ts`
- Ops panel: `frontend/src/components/chat/OpsPanel.tsx`
- Tool card UI: `frontend/src/components/chat/ToolCallCard.tsx`
- Shared frontend types: `frontend/src/lib/types.ts`

## GUI / Computer Use State

Current GUI implementation is browser-backed, not full OS desktop automation yet.

Implemented tools:

- `gui_observe`
- `gui_act`
- `gui_step`

Implemented loop:

1. Capture browser observation.
2. Build grounding prompt.
3. Execute a structured action.
4. Capture next observation.
5. Return reflection/history.

Current limitation:

- `gui_step` can call `resolveGroundedAction` with safety checks, confidence gating, and prompt-only mode.
- Desktop-level GUI control via AppleScript, pyautogui, Windows UIA, or accessibility APIs is not implemented.

## Completed In Latest Pass

GUI grounding provider was made safer and more production-usable.

- `backend/gui/provider.js` now validates allowed action types and returns executable assessment metadata.
- `backend/gui/agent.js` now supports `autoGround`, `groundingMode`, `minConfidence`, prompt-only observation, and confidence-based non-execution.
- `backend/tools/registry.js` exposes `autoGround`, `groundingMode`, and `minConfidence` in `gui_step`.
- `backend/index.js` passes those options into `stepGuiAgent`.
- Frontend now parses `gui_*` runtime artifacts and stores them as GUI memory.
- `ToolCallCard` now renders a GUI Decision panel with action, confidence, reason, observation, and screenshot preview.
- `OpsPanel` now shows the latest GUI runtime artifact separately.
- Added `scripts/gui-smoke.js` and `npm run smoke:gui`.
- GUI smoke test passed after installing Playwright Chromium:
  - `gui_observe` captured a screenshot.
  - prompt-only `gui_step` returned non-executable assessment without acting.
  - manual `gui_act` typed into a known selector.
  - manual `gui_step` clicked a known selector and verified DOM state.
- Frontend build passed after GUI UI updates.
- Fixed GUI routing bug where GUI/browser screenshot requests containing words like "test" or "observation" could be routed as audit/default.
- Added deterministic GUI self-test path in `/api/chat`: for GUI workflow + example.com observe/screenshot requests, BahAI runs `browser_open`, `gui_observe`, and prompt-only `gui_step` without depending on the LLM provider.
- Added visible browser mode:
  - `backend/browserSession.js` supports `getSession(sessionId, { visible, slowMoMs })`.
  - `browser_open` accepts `visible` and `slowMoMs`.
  - GUI self-test opens `example.com` in a visible browser window.
  - `npm run smoke:gui -- --visible --slow-mo=500` can be used to watch the GUI smoke test live.
- Fixed a regression where repeated GUI self-test requests could hit provider 503 before reaching the deterministic GUI tool path. The self-test path now runs before provider candidate/client setup.
- Fixed streaming/final-message preservation bug in `frontend/src/hooks/useChat.ts`: if final `assistant_message` is shorter than the streamed content, the longer stream buffer is kept so TTS/copy/read actions do not collapse the answer to the first sentence.
- Added real Chrome channel support:
  - `backend/browserSession.js` supports `browserChannel` and `executablePath`.
  - `browser_open` accepts `browserChannel: "chrome"`.
  - GUI self-test requests now ask for `browserChannel: "chrome"` and fall back to bundled Chromium if Chrome is unavailable.
  - `npm run smoke:gui -- --visible --chrome --slow-mo=700` tests visible real Chrome mode.
- Improved Chrome login support:
  - macOS installed Chrome path is auto-detected with `findInstalledChromePath()`.
  - `browser_open` supports `persistent` and `userDataDir`.
  - GUI self-test now uses a persistent BahAI browser profile, so login cookies can survive across sessions.
  - Session reuse now preserves existing sessions when later GUI tools call `getSession(sessionId)` without launch options.
- Added human checkpoint UI for login flows:
  - Backend emits `human_checkpoint` for Wix GUI login requests.
  - The request closes after opening visible Chrome, so STOP does not remain active while the user logs in.
  - Frontend shows a modal with `Login oldum` and `Hələ yox`.
  - Clicking `Login oldum` sends the resume prompt automatically.
- Added CDP attach path for Google login-sensitive flows:
  - `browser_open` accepts `cdpUrl`.
  - `backend/browserSession.js` supports `chromium.connectOverCDP`.
  - `npm run chrome:debug` starts Google Chrome with remote debugging on `http://127.0.0.1:9222`.
  - Wix login resume (`login oldum`) now uses deterministic `gui_observe`, so it no longer depends on the LLM provider and should not 503.
- Added GUI browser discovery/settings:
  - `GET /api/browsers` scans known macOS browser installs.
  - Settings panel has a `GUI Browser` section with system scan, browser mode, browser path, and CDP URL.
  - Chat requests now pass `guiBrowserMode`, `guiBrowserPath`, and `guiBrowserCdpUrl`.
  - Wix/example GUI flows use the selected browser mode instead of hardcoded Chrome launch args.
- Added live production smoke coverage:
  - `scripts/prod-smoke.js` performs prod health + auth + basic chat UI smoke against Railway.
  - `npm run smoke:prod`
  - `npm run smoke:prod -- --checkpoint` also verifies GUI login checkpoint creation + resume SSE path.
  - Uses `auth-demo-fill` and `auth-login-submit` test ids in the auth modal.
  - Saves a full-page screenshot into `/artifacts`.
- Added desktop execution smoke coverage:
  - `scripts/desktop-smoke.js` validates desktop-emulated shell behavior against local backend.
  - `npm run smoke:desktop`
  - Covers settings modal, `Local`/`Cloud` execution switching, runtime panel visibility, settings close, and a real chat send flow.
  - Saves a full-page screenshot into `/artifacts`.
- Added Electron shell smoke coverage:
  - `scripts/electron-smoke.js` launches the real Electron app shell.
  - `npm run smoke:electron`
  - Verifies Electron user agent, desktop shell identity, settings modal, settings close, and a real chat send flow.
  - Saves a full-page screenshot into `/artifacts`.

## Next Best Coding Step

Expand smoke coverage to interaction-heavy live flows:

- Add post-login Action Center / checkpoint smoke.
- Add GUI resume smoke around `login oldum` flow.
- Add a provider-backed optional smoke path after the deterministic checks remain stable.

## Known Risk Areas

- `backend/index.js` is still large. Avoid broad refactors unless required.
- Worktree is dirty with many intentional changes. Do not reset or revert user/previous-agent work.
- Use `apply_patch` for manual file edits.
- Avoid overclaiming "Computer Use"; current state is browser GUI agent v0.
- If auditing external projects, read files first and provide findings with file paths.

## User Preference Notes

- User writes mostly Azerbaijani.
- They like autonomous progress: "sukan sendedir", "bashla", "novbeti en guclu addim".
- They do not want every agent to answer every message because tokens are wasted.
- They want BahAI to feel like an orchestral agent, later extended into a GUI SEO agent.
- Keep status updates short and practical.

## Completed Validation From Prior Pass

Previously reported passing checks:

- `node -c backend/index.js`
- `node -c backend/gui/agent.js`
- `node -c backend/gui/provider.js`
- `npm run build --prefix frontend`

Run these again after new edits.

## Fresh Note For Next Agent

- Frontend SSE parser in `/Users/macbookair/Documents/GitHub/BahAI-Agent/frontend/src/lib/api.ts` was hardened so a late stream-close after valid events or `[DONE]` should no longer surface as `network error` in chat UI.
- Root-level Vitest execution exposed a portability issue in backend integration tests: they spawned `index.js` from `process.cwd()`. That is being normalized toward backend-root-relative execution so tests pass whether run from repo root or `backend/`.
- When validating GUI Wix flow, re-test the exact user path:
  1. send Wix login checkpoint prompt
  2. confirm browser opens
  3. confirm chat shows Action Center checkpoint instead of `❌ Xəta: network error`
  4. click `Login oldum` only after manual login

## Update — 2026-07-09 OmniRoute P0

Web BahAI üçün provider routing artıq daha məqsədli işləyir.

- `backend/chat/providers.js`
  - `buildProviderCandidates(...)` indi `hasImageAttachment` və `webTaskType` qəbul edir.
  - `web_chat` üçün ayrıca model routing əlavə olunub:
    - `WEB_CHAT_FAST_MODEL`
    - `WEB_CHAT_SMART_MODEL`
    - `WEB_CHAT_VISION_MODEL`
    - `WEB_CHAT_CODE_MODEL`
  - OmniRoute gateway üstünlüyü əlavə olunub:
    - `OMNIROUTE_ENABLED`
    - `OMNIROUTE_BASE_URL`
    - `OMNIROUTE_API_KEY`
    - `OMNIROUTE_MODEL`

- `backend/routes/chat.js`
  - web chat sorğusu indi sadə şəkildə `general / code / vision` kimi təsnif olunur
  - image attachment varsa `vision` route prioritet alır

- `backend/chat/runner.js`
  - provider failover davranışı sərtləşdirilib
  - 503 / 429 / timeout / network tipli xətalarda alternativ provider-lərə sakit retry edilir
  - cooldown-da olan provider başlanğıcda skip oluna bilir
  - multi-provider tam uğursuz olanda userə daha yumşaq error mesajı qaytarılır

- Testlər
  - `backend/tests/providers.test.js` genişləndirilib
  - `backend/tests/runner.test.js` əlavə olunub
  - Keçən yoxlamalar:
    - `npm test --prefix backend -- tests/providers.test.js tests/runner.test.js`
    - `node --check backend/chat/providers.js`
    - `node --check backend/chat/runner.js`
    - `node --check backend/routes/chat.js`

### Növbəti ən doğru addım

OmniRoute P1:

1. ardıcıl fail edən provider-lər üçün session-level sticky avoidance əlavə et
2. hansı provider/model seçildiyini server-side event/log səviyyəsində izlə
3. web məhsulunda live smoke ilə `weather / current facts / image analysis / code question` matrisi yoxla
4. provider telemetry-ni sonradan admin/debug panelə bağlamaq mümkündür

### Update — 2026-07-09 P1 Telemetry

- `backend/chat/sse.js`
  - `emitProviderTelemetry(...)` əlavə olunub

- `backend/chat/runner.js`
  - provider lifecycle event-ləri emit edir:
    - `provider_skip_cooldown`
    - `provider_stream_start`
    - `provider_failure`
    - `provider_failover`
    - `provider_wireapi_downgrade`

- `backend/routes/chat.js`
  - telemetry event-ləri SSE üzərindən ötürülür
  - `baseURL` sahələri user-facing stream-də redact olunur

- `backend/tests/runner.test.js`
  - failover zamanı telemetry event-lərinin gəldiyi ayrıca yoxlanır

### Update — 2026-07-09 P1 Session Sticky Avoidance

- `backend/helpers.js`
  - provider runtime artıq session-level avoid memory saxlayır
  - yeni helper-lər:
    - `markSessionProviderFailure(sessionKey, providerId)`
    - `markSessionProviderSuccess(sessionKey, providerId)`
    - `shouldAvoidProviderForSession(sessionKey, providerId)`
    - `reorderCandidatesForSession(sessionKey, candidates)`

- `backend/routes/chat.js`
  - provider candidate siyahısı request başlamazdan əvvəl `providerSessionKey` ilə reorder olunur
  - `providerSessionKey` formatı:
    - `${productMode}:${userId || 'anon'}:${conversationId || 'default'}`

- `backend/chat/runner.js`
  - provider failure/success halları artıq session memory-yə də yazılır
  - eyni conversation içində indicə fail etmiş provider növbəti turn-lərdə arxaya düşür

- `backend/tests/runner.test.js`
  - session failure/success marker çağırışları da yoxlanır
