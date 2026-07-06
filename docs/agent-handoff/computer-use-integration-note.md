# Computer Use Integration Note

Current state:

- BahAI now detects the local Codex Computer Use helper app.
- Detection is exposed in:
  - `GET /api/computer-use-status`
  - `GET /api/gui-capabilities` under `computerUse`
- Workflow metadata now includes `computer_use`.
- Routing can classify desktop/UI intent into `computer_use`.
- Frontend Settings and Ops panels now surface Computer Use readiness.

What is not implemented yet:

- No live `computer_use_*` tool execution layer inside BahAI yet.
- No confirmation/checkpoint loop specialized for Computer Use actions yet.
- No session memory artifact type dedicated to desktop app actions yet.
- No bridge from BahAI backend to the native `Codex Computer Use.app` runtime yet.

Most natural next steps:

1. Add a backend Computer Use adapter layer:
   - start/check helper
   - expose screenshot / click / type / keypress primitives
2. Add `computer_use` fastpath handlers similar to GUI fastpath.
3. Add a confirmation policy mapper for risky local GUI actions.
4. Add runtime artifacts for desktop screenshots and action traces.

Relevant files:

- `backend/gui/computerUseStatus.js`
- `backend/gui/capabilityStatus.js`
- `backend/orchestrator/managerRouter.js`
- `backend/orchestrator/workflowResolver.js`
- `backend/orchestrator/workflowCapabilities.js`
- `backend/index.js`
- `frontend/src/components/sidebar/SettingsPanel.tsx`
- `frontend/src/components/chat/OpsPanel.tsx`
