# Orchestration Handoff

## Purpose
This note exists for future agents continuing the orchestration upgrade. It records the contract introduced in the first foundation pass so the next person can build on stable ground instead of re-discovering intent.

## What is already in place
- Frontend settings now carry `orchestrationMode` and `workflow`.
- `/api/chat` now accepts orchestration metadata and resolves it into a workflow contract.
- Chat SSE now emits `orchestration_state` with `runId`, `workflow`, `mode`, and `agents`.
- Task plans are now seeded with workflow-specific steps before the normal file/edit/verify loop.

## Design intent
- Keep the current single-agent runtime intact.
- Add orchestration as metadata and UX first.
- Delay true multi-agent execution until run persistence and agent-role prompts are extracted from `backend/index.js`.

## Recommended next steps
1. Extract orchestration helpers from [backend/index.js](/Users/macbookair/Documents/GitHub/BahAI-Agent/backend/index.js) into `backend/orchestrator/`.
2. Persist run data in DB/local JSON: `runId`, `workflow`, `steps`, `agents`, `status`, `duration`.
3. Introduce role-specific prompt builders for `Planner`, `Builder`, `Reviewer`, `Security`, `QA`.
4. Surface active workflow/run state in `OpsPanel`.
5. Add tests for the orchestration resolver and `/api/chat` orchestration SSE event.

## Guardrails
- Do not replace the current chat loop in one shot.
- Preserve backward compatibility for plain chat requests with no orchestration payload.
- Keep SSE event names stable unless frontend is updated in the same change.
