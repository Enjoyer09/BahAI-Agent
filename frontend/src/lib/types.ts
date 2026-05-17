export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  repoUrl?: string;
  archived?: boolean;
  lastPort?: number;
}

export interface Attachment {
  id: string; // SEC-Audit: id is now mandatory
  name: string;
  type: string;
  mimeType?: string;
  url: string;
  extractedText?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: Attachment[];
  timestamp: number;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ApprovalRequest {
  approvalId: string;
  tool: string;
  args: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  apiKey: string;
  baseUrl: string;
  model: string;
  projectDir: string;
  performanceMode: boolean; // Added for performance toggle
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type SSEEvent = 
  | { type: 'assistant_message'; message: any }
  | { type: 'tool_execution'; tool: string; args: string }
  | { type: 'tool_result'; result: any }
  | { type: 'task_plan'; items: string[] }
  | { type: 'approval_request'; approvalId: string; tool: string; args: string }
  | { type: 'workspace_updated'; path: string }
  | { type: 'error'; message: string }
  | { type: 'debug'; info: any };
