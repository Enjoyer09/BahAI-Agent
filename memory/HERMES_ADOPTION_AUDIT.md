# Hermes Adoption Audit for BahAI

## Context
- Date: 2026-06-22
- Compared repos:
  - BahAI: `/Users/macbookair/Documents/GitHub/BahAI-Agent`
  - Hermes: `https://github.com/NousResearch/hermes-agent`
- Goal: identify where BahAI is behind Hermes and what we can realistically adopt without rewriting BahAI into a Python-first architecture.

## Executive summary
BahAI already has the first orchestration UX layer, approval flow, project memory endpoint, and workflow metadata. But most of it is still "single runtime with orchestration hints", not a true orchestration engine yet.

Hermes is ahead in five important areas:
1. Modular toolset registry
2. Real delegation/subagent execution
3. Mature memory and trajectory handling
4. Better guardrails around tool output, approvals, and result storage
5. Skills/plugin ecosystem structure

The right move is not to clone Hermes. The right move is to port the architecture ideas into BahAI's Node/Electron stack.

## Current BahAI state

### Already present
- Workflow presets and orchestration metadata exist in [backend/index.js](/Users/macbookair/Documents/GitHub/BahAI-Agent/backend/index.js:223)
- Chat SSE emits orchestration state and seeded task plans in [backend/index.js](/Users/macbookair/Documents/GitHub/BahAI-Agent/backend/index.js:3177)
- Frontend settings expose Orchestra Mode and workflow selection in [frontend/src/components/sidebar/SettingsPanel.tsx](/Users/macbookair/Documents/GitHub/BahAI-Agent/frontend/src/components/sidebar/SettingsPanel.tsx:207)
- Frontend passes orchestration settings into `/api/chat` in [frontend/src/hooks/useChat.ts](/Users/macbookair/Documents/GitHub/BahAI-Agent/frontend/src/hooks/useChat.ts:343)
- Approval flow exists and is wired through SSE in [backend/index.js](/Users/macbookair/Documents/GitHub/BahAI-Agent/backend/index.js:3488)
- Project memory persistence exists in [backend/index.js](/Users/macbookair/Documents/GitHub/BahAI-Agent/backend/index.js:2790)

### Main limitation
Most orchestration logic is still embedded in one large backend file:
- [backend/index.js](/Users/macbookair/Documents/GitHub/BahAI-Agent/backend/index.js)

This means BahAI currently simulates multi-role execution in planning and UX, but does not yet have isolated role runtimes, subagent contracts, or reusable orchestration modules.

## Hermes -> BahAI gap map

### 1. Toolset registry
Hermes strength:
- `toolsets.py` groups tools into named capability bundles
- toolsets can include other toolsets
- different surfaces can expose different tools safely

BahAI today:
- Tools are effectively defined and executed through the monolithic chat runtime
- no first-class registry for "coding", "audit", "research", "desktop", "safe", or "local-only" tool profiles

Gap severity:
- High

What BahAI should adopt:
- Create `backend/tools/registry.js`
- Create `backend/tools/profiles.js`
- Define profiles like:
  - `default`
  - `audit`
  - `coding`
  - `review-only`
  - `desktop-local`
- Resolve active tool profile from workflow + safeMode + environment

Why this should be first:
- It is the cleanest foundational import from Hermes
- It reduces `backend/index.js` complexity
- It makes later delegation and approvals much easier

### 2. Delegation and subagents
Hermes strength:
- runtime supports delegation patterns and async subagent work
- agent roles are more than labels; they can own scoped work

BahAI today:
- role names exist in workflow metadata
- no true Planner/Builder/Reviewer subprocess or scoped prompt execution yet

Gap severity:
- Very high

What BahAI should adopt:
- Create `backend/orchestrator/`
- Add:
  - `workflowResolver.js`
  - `rolePrompts.js`
  - `runManager.js`
  - `delegationEngine.js`
- Start with sequential delegation, not parallel:
  1. Planner produces plan
  2. Builder executes
  3. Reviewer checks output
- Keep all three inside one request lifecycle at first, but as separate prompt phases with explicit contracts

Important note:
- Do not jump directly to background workers or parallel execution yet. First extract clean role boundaries.

### 3. Memory and trajectory handling
Hermes strength:
- better long-run memory handling
- better task trajectory/history preservation
- better reuse of prior work

BahAI today:
- project memory exists, but is injected as one JSON blob into prompt
- no run-level memory, no structured findings memory, no tool trajectory artifacts

Gap severity:
- High

What BahAI should adopt:
- Split memory into layers:
  - `project memory`
  - `run memory`
  - `findings memory`
  - `tool artifact memory`
- Store structured run artifacts:
  - runId
  - workflow
  - steps
  - tool calls
  - approvals
  - final summary
- Add retrieval helpers instead of dumping raw JSON into the system prompt

Recommended files:
- `backend/memory/projectMemory.js`
- `backend/memory/runStore.js`
- `backend/memory/contextBuilder.js`

### 4. Guardrails and tool result handling
Hermes strength:
- explicit approval utilities
- output limiting
- result storage
- safer handling of large tool outputs

BahAI today:
- approval loop exists and is decent
- large outputs are still mostly streamed inline into conversation state
- tool result handling is not yet normalized into reusable policies

Gap severity:
- Medium-high

What BahAI should adopt:
- Create:
  - `backend/tools/outputPolicy.js`
  - `backend/tools/resultStore.js`
  - `backend/tools/approvalPolicy.js`
- Add policies:
  - truncate long command output in chat
  - store full artifact separately
  - summarize file listings and diffs before sending to model
  - classify tool risk by category, not by ad hoc checks only

Most user-visible benefit:
- cleaner chats
- less prompt pollution
- fewer model derailments on long outputs

### 5. Skills system
Hermes strength:
- strong skills taxonomy
- reusable behavior packs for different work types

BahAI today:
- workflows exist
- skills as persistent, named, reusable operating instructions do not

Gap severity:
- Medium-high

What BahAI should adopt:
- Create `backend/skills/`
- Start with simple file-backed skills:
  - `audit.md`
  - `security-review.md`
  - `frontend-fix.md`
  - `refactor.md`
  - `devops-audit.md`
- Load skill instructions conditionally by workflow and task classifier

Important distinction:
- In BahAI, "workflow" should decide role choreography
- "skill" should decide task behavior and domain instructions

### 6. Provider/runtime diversity
Hermes strength:
- mature runtime/provider switching

BahAI today:
- already better than a basic app here
- has auto routing and local/cloud fallback logic in [backend/index.js](/Users/macbookair/Documents/GitHub/BahAI-Agent/backend/index.js:278)

Gap severity:
- Low-medium

Conclusion:
- This is not the first area to copy from Hermes because BahAI already has a decent base.

### 7. Scheduling / automation
Hermes strength:
- cron-like and automation-oriented patterns

BahAI today:
- no real recurring jobs or unattended orchestration loop

Gap severity:
- Medium

Recommendation:
- Leave this for later, after tool registry + delegation + run persistence exist.

## Concrete implementation order

### Phase 1: foundation extraction
1. Extract orchestration config from `backend/index.js` into `backend/orchestrator/workflowResolver.js`
2. Extract tool definitions into `backend/tools/registry.js`
3. Add tool profiles in `backend/tools/profiles.js`
4. Add `backend/orchestrator/rolePrompts.js`

### Phase 2: real orchestration
1. Add `runManager.js` with run metadata
2. Implement sequential Planner -> Builder -> Reviewer execution
3. Emit richer SSE events for run phase transitions
4. Show run state inside Ops panel

### Phase 3: memory and artifacts
1. Persist run records
2. Store summarized tool results separately from raw results
3. Build structured context assembly instead of raw JSON dump

### Phase 4: skills
1. Add file-backed skills
2. Map skills to workflows and task classifier
3. Let the user choose a skill explicitly in UI later

### Phase 5: advanced
1. parallel subagents
2. automation/scheduling
3. pluginized external tool packs

## Recommended immediate next coding task
Implement Hermes-style toolset/profile registry first.

Why:
- lowest-risk architectural win
- unlocks cleaner approvals
- unlocks workflow-specific tool exposure
- makes later multi-agent orchestration much easier

## Suggested target file structure

```text
backend/
  orchestrator/
    workflowResolver.js
    rolePrompts.js
    runManager.js
    delegationEngine.js
  tools/
    registry.js
    profiles.js
    approvalPolicy.js
    outputPolicy.js
    resultStore.js
  memory/
    projectMemory.js
    runStore.js
    contextBuilder.js
  skills/
    audit.md
    devops-audit.md
    security-review.md
    frontend-fix.md
```

## Notes for next agents
- Preserve backward compatibility for plain chat requests.
- Do not replace the current chat loop in one large rewrite.
- First extract modules from `backend/index.js`, then change behavior.
- The current orchestration UX is real enough to keep; the missing piece is execution architecture.
- There is already a related note in [memory/ORCHESTRATION_HANDOFF.md](/Users/macbookair/Documents/GitHub/BahAI-Agent/memory/ORCHESTRATION_HANDOFF.md).

## Suggested follow-up after reading this note
- Start implementation with:
  - `backend/tools/registry.js`
  - `backend/tools/profiles.js`
  - `backend/orchestrator/workflowResolver.js`
- Then refactor `backend/index.js` to consume those modules with no behavior change first.
