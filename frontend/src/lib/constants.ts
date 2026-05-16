import { ModelOption } from './types';

export const API_BASE_URL = 'http://localhost:3001';

export const MODELS: ModelOption[] = [
  { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', provider: 'NVIDIA' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'NVIDIA' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', provider: 'NVIDIA' },
  { id: 'mistralai/mixtral-8x7b-instruct-v0.1', name: 'Mixtral 8x7B', provider: 'NVIDIA' },
  { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B', provider: 'NVIDIA' }
];

export const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  model: 'meta-llama/llama-3.1-405b-instruct',
  projectDir: '',
  performanceMode: false
};
