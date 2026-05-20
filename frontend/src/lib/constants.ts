import type { ModelOption } from './types';
import { List, Search, FileText, Edit, Terminal, Globe, GitBranch, GitCommit, Code2, FileSearch, Eye, Play, TestTube, Upload, Layers } from 'lucide-react';

export const API_BASE_URL = import.meta.env.MODE === 'production' 
  ? window.location.origin 
  : 'http://localhost:3001';
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export const MODELS: ModelOption[] = [
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron 3 Super', provider: 'bahAI' },
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder', provider: 'bahAI' },
  { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash', provider: 'bahAI' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B', provider: 'bahAI' },
];

export const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'nvidia/nemotron-3-super-120b-a12b:free',
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
