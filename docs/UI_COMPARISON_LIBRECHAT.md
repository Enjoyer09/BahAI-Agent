# UI Müqayisə Hesabatı: BahAI vs LibreChat

Tarix: 2026-08-02
Mənbə: lokal `frontend/src` (BahAI) + GitHub `danny-avila/librechat` `client/src` (main branch, araşdırma anında).

## 1. Ümumi mənzərə

| Aspekt | BahAI | LibreChat |
|---|---|---|
| Stack | React 19 + Vite 6 + TS, Tailwind v4 (`@tailwindcss/postcss`) | React + Vite + TS, Tailwind + shadcn/ui + @react-spring/web animasiyalar |
| State | Recoil yoxdur — custom hooks (`useChat`, `useSettings`) + `store/` reducers | Recoil (global `store/`) + react-hook-form + TanStack Query |
| Struktur | `frontend/src/components/{chat,sidebar,landing,auth,common}` | `client/src/components/{Chat,Conversations,Nav,Input,Messages,Agents,Artifacts,...}` |
| Routing | Sadə: `/` landing, `/chat` chat | React Router (çox səhifəli: chat, settings, admin, share) |

## 2. Görünüş (Appearance) müqayisəsi

### BahAI
- **Landing (`components/landing/LandingPage.tsx`)** — tünd `#09090b` fon, gradient hero başlıq, IntersectionObserver ilə scroll animasiyaları, stat barlar, xüsusiyyət/qıymət bölmələri. Çox "marketing səhifəsi" görünüşü.
- **Chat UI** — CSS dəyişənləri (`--bg-main`, `--bg-surface`, `--border`, `--fg-muted`, `--color-accent`) ilə theme; Tailwind + inline style hibrid. Sidebar draggable-resize (280px default). Mobil üçün drawer + topbar.
- **Desktop aux panellər** — CodeEditor (Monaco), LivePreview, Terminal, OpsPanel — sağda/solda overlay panellər.
- **MessageBubble** — markdown render, aksiya ikonları (copy/thumbs/speak/regenerate), attachment önizləmələri.
- **Font/ölçü ayarları** — `Settings`-də `messageFontSize`, `chatDirection`, `maximizeChatSpace`, `centerChatInput`, `scrollToEndButton` (LibreChat-dən ilhamlanıb, artıq var).

### LibreChat
- **Landing (`Chat/Landing.tsx`)** — `@react-spring/web` `SplitText` ilə animasiyalı greeting, endpoint/model spec chip-ləri, `centerFormOnLanding` dəstəyi.
- **ChatView (`Chat/ChatView.tsx`, `Presentation.tsx`)** — 3 sütunlu layout (nav + chat + side panel), header'da model/endpoint göstəricisi.
- **Input (`Chat/Input/ChatForm.tsx`)** — `TextareaAutosize`, file chips, MCP/skills/agents menyuları, AudioRecorder, StreamAudio, TokenUsage, SendButton/StopButton — çox zəngin.
- **Messages (`Messages/MessageContent.tsx`)** — streaming content, token səviyyəli render.
- **UnifiedSidebar + Nav** — search bar, bookmarks, favorites, settings tabs, keyboard shortcuts.
- **Artifacts, Agents, Projects** — tam ayrı UI bölmələri.

## 3. Funksionallıq müqayisəsi

### BahAI-də olan
- Chat + attachment (şəkil/fayl) + canlı axtarış (Tavily/Google/DDG)
- Auth modal (email/sosial), theme toggle (light/dark/system)
- Desktop kod agenti: fayl tree, terminal, live preview, Ops panel, approval flow, ActionCenter
- Orchestration/GUI/SEO workflow-lar (desktop)
- URL routing `/chat`, `Ctrl+B`/`` Ctrl+` ``/`Ctrl+J` klaviatura qısayolları
- i18n (`lib/i18n.ts`), toast, error boundary

### LibreChat-də olan (BahAI-də yox və ya zəif)
1. **Model/endpoint switching** — istifadəçi modeli seçir; BahAI web-də bilərəkdən gizli routing (məhsul qərarı)
2. **Agents + Assistants** — ayrıca "agent" obyektləri və builder UI
3. **Artifacts** — kod/HTML nəticə panelləri
4. **MCP UI** (`Input/MCPConfigDialog.tsx`, `MCPSelect`, `MCPSubMenu`) — server qoşma/konfiqurasiya
5. **Skills** (`Skills.tsx`, `SkillsCommand.tsx`) — icra oluna bilən skill dəsti
6. **Projects** (`ProjectsSection.tsx`) — chat-ləri layihə altında qruplaşdırma
7. **Bookmarks/Favorites/Search** — mesaj və söhbət axtarışı, bookmark
8. **Keyboard shortcuts dialog** — qısayol kəşfi
9. **Share/Export** — söhbət paylaşma linkləri, export menyusu
10. **Audio** — səs yazma (AudioRecorder) + səsli stream
11. **Token usage göstəricisi** — UI-da token istifadəsi (BahAI web-də gizli saxlanılır — məhsul qərarı)
12. **Code Interpreter** — sandbox icra
13. **Presets/endpoint config** — provider bazalı preset-lər

## 4. Fayl səviyyəsində xəritə

| BahAI | LibreChat ekvivalenti |
|---|---|
| `components/chat/ChatArea.tsx` | `Chat/ChatView.tsx` + `Messages/Content` |
| `components/chat/MessageBubble.tsx` | `Messages/MessageContent.tsx` |
| `components/chat/Composer.tsx`, `ChatInput.tsx` | `Chat/Input/ChatForm.tsx` + `TextareaAutosize` |
| `components/sidebar/Sidebar.tsx` | `UnifiedSidebar` + `Nav/` |
| `components/sidebar/ConversationList.tsx` | `Conversations/Conversations.tsx` |
| `components/landing/LandingPage.tsx` | `Chat/Landing.tsx` (welcome ekranı) |
| `components/common/MarkdownRenderer.tsx` | `Messages/Content/Markdown` |
| `components/auth/AuthModal.tsx` | `Auth/` + `OAuth/` |
| `components/chat/OpsPanel.tsx`, `ActionCenterModal.tsx` | (analoqu yoxdur — desktop-spesifik) |
| `lib/types.ts` | `packages/data-provider` (paylaşılan tiplər) |
| `store/chatService.ts` | `store/` + `hooks/Chat/` |

## 5. Nəticə və tövsiyələr

**BahAI-nin güclü tərəfləri:** sadə istifadəçi təcrübəsi (heç nə seçmək lazım deyil), desktop üçün dərin agent alətləri (terminal/preview/approval), məhsul-əsrli gizli routing.

**LibreChat-dən götürməyə dəyər:** (a) tam fayl emal pipeline-ı (sharp + storage strategiyaları — hazırda BahAI-da skeletal `attachmentPipeline.js`), (b) real MCP dəstəyi (`mcpGateway.js` hazırda statik config oxuyur, real stdio client deyil), (c) provider spec qatı (`providers.js` monolitdir, LibreChat `app/clients/*` spec-ləri ilə genişləndirilir), (d) paylaşılan tiplər paketi (LibreChat `packages/data-provider`, BahAI-da tiplər `frontend/src/lib/types.ts` ilə backend arasında əl ilə sinxronlaşır).

Bu hesabatdakı 4 boşluq aşağıdakı dəyişikliklərlə bağlanır (bax: commit hesabatı).
