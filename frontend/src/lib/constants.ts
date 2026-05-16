import type { ModelOption } from './types';
import { List, Search, FileText, Edit, Terminal, Globe } from 'lucide-react';

export const API_BASE_URL = import.meta.env.MODE === 'production' 
  ? window.location.origin 
  : 'http://localhost:3001';
export const DEFAULT_BASE_URL = 'https://opencode.ai/zen/v1';

export const MODELS: ModelOption[] = [
  { id: 'minimax-m2.5-free', name: 'MiniMax M2.5 Free', provider: 'OpenCode' },
  { id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free', provider: 'OpenCode' },
  { id: 'nemotron-3-super-free', name: 'Nemotron 3 Super Free', provider: 'OpenCode' },
  { id: 'ring-2.6-1t-free', name: 'Ring 2.6 1T Free', provider: 'OpenCode' }
];

export const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://opencode.ai/zen/v1',
  model: 'deepseek-v4-flash-free',
  projectDir: '',
  performanceMode: false
};

export const TOOL_ICONS: Record<string, any> = {
  list_directory: List,
  glob_search: Search,
  read_file: FileText,
  write_file: Edit,
  file_edit: Edit,
  run_bash: Terminal,
  run_terminal_command: Terminal,
  grep_search: Globe,
  git_clone: Globe
};

export const TOOL_LABELS: Record<string, string> = {
  list_directory: 'Faylları siyahıla',
  glob_search: 'Fayl axtar',
  read_file: 'Faylı oxu',
  write_file: 'Faylı yarat',
  file_edit: 'Faylı redaktə et',
  run_bash: 'Terminal əmri',
  run_terminal_command: 'Terminal əmri',
  grep_search: 'Mətn axtar (Grep)',
  git_clone: 'GitHub Klonla'
};
