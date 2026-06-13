import type { ModelOption } from './types';
import { List, Search, FileText, Edit, Terminal, Globe, GitBranch, GitCommit, Code2, FileSearch, Eye, Play, TestTube, Upload, Layers } from 'lucide-react';

export const API_BASE_URL = import.meta.env.MODE === 'production' 
  ? window.location.origin 
  : 'http://localhost:3001';
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export const MODELS: ModelOption[] = [
  // FUNC-FIX: Auto — smart router. Picks local Qwen 7B for short/simple
  // queries and cloud Claude Sonnet 4.5 for refactor/architecture / long
  // context. Set OPENAI_API_KEY in Settings for cloud failover.
  { id: 'auto', name: '✨ Auto (Smart Router)', provider: 'Hibrid' },
  // cloud-tier frontier models for "production quality" mode. Users
  // provide an OpenRouter key in Settings; baseUrl defaults to openrouter.ai.
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 ⭐', provider: 'Cloud (Frontier)' },
  { id: 'openai/gpt-5.2', name: 'GPT-5.2 ⭐', provider: 'Cloud (Frontier)' },
  { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash ⚡', provider: 'Cloud (Sürətli)' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 ⚡', provider: 'Cloud (Sürətli)' },
  // Free tier (OpenRouter free models — slower & rate-limited but no key cost)
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (Pulsuz)', provider: 'OpenRouter Free' },
  { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash (Pulsuz)', provider: 'OpenRouter Free' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Pulsuz)', provider: 'OpenRouter Free' },
  // Local Ollama — for offline use; slower but private
  { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B (Tövsiyə)', provider: 'Ollama (Lokal)' },
  { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', provider: 'Ollama (Lokal)' },
  { id: 'gemma4:latest', name: 'Gemma 4 9B', provider: 'Ollama (Lokal)' },
  { id: 'gemma4:e2b', name: 'Gemma 4 7B', provider: 'Ollama (Lokal)' },
  { id: 'gemma4:12b', name: 'Gemma 4 12B (Ləng)', provider: 'Ollama (Lokal)' },
  { id: 'llama3:8b', name: 'Llama 3 8B', provider: 'Ollama (Lokal)' },
];

export const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  // FUNC-FIX: default to Auto — fastest path for most users; falls back to
  // local Ollama if no cloud key is set.
  model: 'auto',
  projectDir: '',
  performanceMode: false
};

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
  check_port_status: Play
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
  check_port_status: 'Port Yoxla'
};
