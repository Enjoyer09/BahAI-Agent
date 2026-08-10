import type { ModelOption } from './types';
import { List, Search, FileText, Edit, Terminal, Globe, GitBranch, GitCommit, Code2, FileSearch, Eye, Play, TestTube, Upload, Layers, MousePointerClick, Keyboard, Camera, Timer, Braces, ArrowDownToLine, MoveVertical, ScanSearch, MonitorCog, BrainCircuit } from 'lucide-react';

export const API_BASE_URL = import.meta.env.MODE === 'production' 
  ? window.location.origin 
  : 'http://localhost:3001';
export const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

export const MODELS: ModelOption[] = [
  // Curated, actually useful model list. Keep the set compact and based on
  // real provider paths we expect users to run.
  { id: 'auto', name: '✨ Bahar Smart (OmniRoute)', provider: 'Hibrid' },
  // Puter AI (100% Keyless Free Cloud)
  { id: 'puter:gpt-4o-mini', name: '⚡ Puter AI: GPT-4o Mini (Pulsuz)', provider: 'Puter AI' },
  { id: 'puter:claude-3-5-sonnet', name: '⚡ Puter AI: Claude 3.5 Sonnet (Pulsuz) ⭐', provider: 'Puter AI' },
  { id: 'puter:deepseek-r1', name: '⚡ Puter AI: DeepSeek R1 (Pulsuz) 🧠', provider: 'Puter AI' },
  // Local Ollama / MLX
  { id: 'gemma4:12b', name: 'Gemma 4 12B MLX ⭐', provider: 'Ollama / MLX (Lokal)' },
  { id: 'gemma4:latest', name: 'Gemma 4 9B', provider: 'Ollama / MLX (Lokal)' },
  { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', provider: 'Ollama (Lokal)' },
  { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', provider: 'Ollama (Lokal)' },
  { id: 'llama3:8b', name: 'Llama 3 8B', provider: 'Ollama (Lokal)' },
  // AirLLM (70B+ on 4GB GPU)
  { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (AirLLM) 🧠', provider: 'AirLLM (Lokal)' },
  { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B (AirLLM) 🧠', provider: 'AirLLM (Lokal)' },
  { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 671B (AirLLM) 🧠', provider: 'AirLLM (Lokal)' },
  // Cloud / frontier
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 ⭐', provider: 'Cloud (Frontier)' },
  { id: 'openai/gpt-5.2', name: 'GPT-5.2 ⭐', provider: 'Cloud (Frontier)' },
  { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash ⚡', provider: 'Cloud (Sürətli)' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 ⚡', provider: 'Cloud (Sürətli)' },
  // Freebuff2API proxy (OpenAI-compatible)
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (Freebuff) ⭐', provider: 'Freebuff' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6 (Freebuff)', provider: 'Freebuff' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7 (Freebuff)', provider: 'Freebuff' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (Freebuff) ⚡', provider: 'Freebuff' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (Freebuff) ⚡', provider: 'Freebuff' },
  { id: 'gpt-5.4', name: 'GPT-5.4 (Freebuff)', provider: 'Freebuff' },
  { id: 'gpt-4.1', name: 'GPT-4.1 (Freebuff)', provider: 'Freebuff' },
  { id: 'gpt-4o', name: 'GPT-4o (Freebuff)', provider: 'Freebuff' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Freebuff)', provider: 'Freebuff' },
  // FreeModel
  { id: 'gpt-5.5', name: 'GPT-5.5 ⭐ (FreeModel)', provider: 'FreeModel' },
  { id: 'gpt-5.4', name: 'GPT-5.4 (FreeModel)', provider: 'FreeModel' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (FreeModel)', provider: 'FreeModel' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini ⚡ (FreeModel)', provider: 'FreeModel' },
  // OpenRouter 90+ Free Models
  { id: 'tencent/hy3:free', name: 'Tencent Hy3 295B (Pulsuz) ⭐🧠', provider: 'OpenRouter Free' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Pulsuz) ⚡', provider: 'OpenRouter Free' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Pulsuz) ⭐', provider: 'OpenRouter Free' },
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 Reasoning (Pulsuz) ⭐', provider: 'OpenRouter Free' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B (Pulsuz) 💻', provider: 'OpenRouter Free' },
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (Pulsuz)', provider: 'OpenRouter Free' },
  { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash (Pulsuz)', provider: 'OpenRouter Free' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Pulsuz)', provider: 'OpenRouter Free' },
  { id: 'mistralai/mistral-small-24b-instruct-2501:free', name: 'Mistral 24B (Pulsuz)', provider: 'OpenRouter Free' }
];

export const DEFAULT_SETTINGS = {
  productMode: (typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron')) ? 'desktop_code' : 'web_chat',
  executionMode: 'cloud',
  apiKey: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'gemma4:12b',
  projectDir: '',
  performanceMode: false,
  orchestrationMode: true,
  workflow: 'default',
  guiBrowserMode: 'persistent',
  guiBrowserPath: '',
  guiBrowserCdpUrl: 'http://127.0.0.1:9222',
  guiAutoStartBrowser: false,
  customInstructions: '',
  aiMode: 'smart'
};

export const WORKFLOW_OPTIONS = [
  { id: 'quick', name: 'Quick', description: 'Tək implementer agent, sürətli icra' },
  { id: 'default', name: 'Default', description: 'Planner -> Builder -> Reviewer' },
  { id: 'gui', name: 'GUI Agent', description: 'Browser GUI observe -> action -> reflection loop' },
  { id: 'computer_use', name: 'Computer Use', description: 'Local Mac app / mouse / keyboard control workflow' },
  { id: 'seo_gui', name: 'SEO GUI', description: 'SEO strategist + GUI operator + reviewer' },
  { id: 'thorough', name: 'Thorough', description: 'Architect -> Builder -> Security -> QA' },
  { id: 'review-only', name: 'Review Only', description: 'Mövcud kodu audit və risk analizi' },
];

export const TOOL_ICONS: Record<string, any> = {
  list_directory: List,
  glob_search: Search,
  read_file: FileText,
  write_file: Edit,
  file_edit: Edit,
  multi_file_edit: Layers,
  run_bash: Terminal,
  run_terminal_command: Terminal,
  grep_search: Search,
  git_clone: GitBranch,
  git_status: GitBranch,
  git_diff: GitCommit,
  git_commit: GitCommit,
  git_push: Upload,
  git_log: GitCommit,
  git_branch: GitBranch,
  analyze_codebase: Code2,
  find_definition: FileSearch,
  find_references: Eye,
  web_search: Globe,
  web_fetch: Globe,
  run_tests: TestTube,
  start_server: Play,
  check_port_status: Play,
  browser_open: Globe,
  browser_click: MousePointerClick,
  browser_type: Keyboard,
  browser_screenshot: Camera,
  browser_wait_for: Timer,
  browser_eval: Braces,
  browser_press: ArrowDownToLine,
  browser_scroll: MoveVertical,
  browser_extract: ScanSearch,
  gui_observe: MonitorCog,
  gui_act: MousePointerClick,
  gui_step: BrainCircuit,
  screen_open_url: Globe,
  screen_screenshot: Camera,
  screen_click: MousePointerClick,
  screen_type: Keyboard,
  screen_press: ArrowDownToLine,
  screen_scroll: MoveVertical,
  computer_use_act: MousePointerClick,
  computer_use_step: BrainCircuit
};

export const TOOL_LABELS: Record<string, string> = {
  list_directory: 'Faylları siyahıla',
  glob_search: 'Fayl axtar',
  read_file: 'Faylı oxu',
  write_file: 'Faylı yarat',
  file_edit: 'Faylı redaktə et',
  multi_file_edit: 'Çoxlu fayl redaktə',
  run_bash: 'Terminal əmri',
  run_terminal_command: 'Terminal əmri',
  grep_search: 'Mətn axtar',
  git_clone: 'Repo klonla',
  git_status: 'Git Status',
  git_diff: 'Git Diff',
  git_commit: 'Git Commit',
  git_push: 'Git Push',
  git_log: 'Git Tarixçə',
  git_branch: 'Git Branch',
  analyze_codebase: 'Kodu Analiz Et',
  find_definition: 'Tərifini Tap',
  find_references: 'İstinadları Tap',
  web_search: 'Web Axtar',
  web_fetch: 'Səhifə Oxu',
  run_tests: 'Testləri İşə Sal',
  start_server: 'Server Başlat',
  check_port_status: 'Port Yoxla',
  browser_open: 'Brauzerdə Aç',
  browser_click: 'Brauzerdə Klik',
  browser_type: 'Brauzerdə Yaz',
  browser_screenshot: 'Ekran Şəkli Al',
  browser_wait_for: 'Brauzerdə Gözlə',
  browser_eval: 'Brauzeri Yoxla',
  browser_press: 'Düymə Bas',
  browser_scroll: 'Brauzerdə Scroll',
  browser_extract: 'Məlumat Çıxart',
  gui_observe: 'GUI Müşahidə',
  gui_act: 'GUI Action',
  gui_step: 'GUI Addım',
  screen_open_url: 'URL Aç (Real Brauzer)',
  screen_screenshot: 'Ekran Şəkli',
  screen_click: 'Ekranda Klik',
  screen_type: 'Klaviatura Yaz',
  screen_press: 'Düymə Bas',
  screen_scroll: 'Ekranda Scroll',
  computer_use_act: 'Computer Use Action',
  computer_use_step: 'Computer Use Step'
};
