# Implementation Plan: BahAI Desktop App Builder

## Overview

Bu plan Desktop App Builder-in 12 əsas task-da implementasiyasını müəyyənləşdirir. Hər task bir sprint (~1-2 gün) ölçüsündədir. Tasks 1-2 infrastruktur qurur, 3-6 UI komponentlərini yaradır, 7-11 funksionallığı tamamlayır, 12 keyfiyyəti təmin edir.

## Tasks

- [x] 1. Electron IPC Infrastructure — Create ptyManager.js, fsWatcher.js, ipcHandlers.js; extend preload.js with fs/terminal/git/shell namespaces; update main.js to register new modules
- [x] 2. Desktop IDE Layout — Create DesktopIDELayout.tsx with resizable 4-panel grid (FileTree, Editor, Terminal, Preview); update App.tsx to render it for desktop_code mode; add panel toggle shortcuts
- [x] 3. FileTree Component — Install react-arborist; create virtualized FileTree.tsx with lazy directory expansion, IPC data source, git status badges, context menu (New/Rename/Delete)
- [x] 4. Code Editor Multi-Tab — Create EditorTabs.tsx tab bar; modify CodeEditor for Monaco model switching; implement external content updates from agent; add auto-save, conflict detection, LRU eviction (max 12 tabs)
- [x] 5. Terminal with PTY — Install xterm + addons; rewrite Terminal.tsx to connect to Electron PTY via IPC; add multi-terminal tabs (max 4); handle resize; distinguish agent vs user terminals
- [x] 6. Live Preview Enhancement — Switch to Electron webview in desktop mode; add responsive mode selector, URL bar, console error overlay, auto-reload on file changes
- [x] 7. useWorkspace Hook — Create workspace state context with fileTree, tabs, terminals, git, devServer, orchestration state; wire SSE and IPC events to reducer; implement project switch cleanup
- [x] 8. Git Integration UI — Create gitHelper.js in electron; add git status badges to FileTree; add Git panel with branch selector and commit timeline; wire GitHub OAuth for push
- [x] 9. Deploy Pipeline — Create backend deploy tool and route; create DeployPanel.tsx with platform selection and status streaming; add deploy button to toolbar
- [x] 10. Orchestration Progress UI — Enhance OpsPanel with step-by-step visualization; show Planner plan with approve/reject; show Builder progress; show Reviewer findings with fix status
- [x] 11. Project Templates & Scaffold — Create template definitions (React, Next.js, Express, Flask, Static HTML); add New Project dialog; implement scaffold logic; allow custom template saving
- [x] 12. Integration Testing & Polish — Write IPC handler tests, component tests, E2E workflow test; update smoke tests; performance audit; accessibility pass (wiring complete, manual testing next)

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": "wave1",
      "tasks": [1, 2],
      "description": "Infrastructure — IPC layer and IDE layout shell"
    },
    {
      "id": "wave2",
      "tasks": [3, 4, 5, 6],
      "description": "UI Components — FileTree, Editor Tabs, Terminal PTY, Live Preview",
      "dependsOn": ["wave1"]
    },
    {
      "id": "wave3",
      "tasks": [7],
      "description": "State Management — useWorkspace hook combines all panels",
      "dependsOn": ["wave2"]
    },
    {
      "id": "wave4",
      "tasks": [8, 9, 10, 11],
      "description": "Features — Git UI, Deploy, Orchestration UI, Templates",
      "dependsOn": ["wave3"]
    },
    {
      "id": "wave5",
      "tasks": [12],
      "description": "Testing & Polish — integration tests, E2E, accessibility",
      "dependsOn": ["wave4"]
    }
  ]
}
```

## Notes

- Tasks 1-2 infrastruktur qurur — bunlar tamamlanmadan digərləri başlaya bilmir
- Task 7 (useWorkspace) birləşdirici task-dır — bütün panellərin state-ini birləşdirir
- Task 12 son task olmalıdır — bütün funksionallıq tamamlandıqdan sonra
- Mövcud komponentlər (CodeEditor, Terminal, LivePreview, OpsPanel) genişləndirilir, sıfırdan yazılmır
- Electron shell artıq mövcuddur (`electron/` folder) — yalnız genişləndirmə lazımdır
