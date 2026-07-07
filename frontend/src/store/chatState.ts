// ==========================================
// Chat State Types & Initial State
// ==========================================

import type {
  Project, Conversation, Message, ApprovalRequest, HumanCheckpoint,
  ActionCenterInteraction, PlannerArtifact, ExecutionArtifact, Settings
} from '../lib/types';

export interface ChatState {
  projects: Project[];
  conversations: Conversation[];
  activeConvId: string | null;
  loading: boolean;
  hydrated: boolean;
  serverBacked: boolean;
  abortController: AbortController | null;
  previewKey: number;
  safeMode: boolean;
  taskPlan: string[];
  pendingApprovals: ApprovalRequest[];
  humanCheckpoint: HumanCheckpoint | null;
  actionCenterInteractions: ActionCenterInteraction[];
  actionCenterHistory: ActionCenterInteraction[];
  projectMemory: Record<string, unknown>;
  plannerArtifact: PlannerArtifact | null;
  executionArtifacts: ExecutionArtifact[];
}

export function createInitialState(): ChatState {
  return {
    projects: [],
    conversations: [],
    activeConvId: null,
    loading: false,
    hydrated: false,
    serverBacked: false,
    abortController: null,
    previewKey: 0,
    safeMode: localStorage.getItem('safeMode') === '1',
    taskPlan: [],
    pendingApprovals: [],
    humanCheckpoint: null,
    actionCenterInteractions: [],
    actionCenterHistory: [],
    projectMemory: {},
    plannerArtifact: null,
    executionArtifacts: [],
  };
}

// ==========================================
// Action Types
// ==========================================

export type ChatAction =
  | { type: 'SET_PROJECTS'; projects: Project[] }
  | { type: 'ADD_PROJECT'; project: Project }
  | { type: 'UPDATE_PROJECT'; id: string; updates: Partial<Project> }
  | { type: 'REMOVE_PROJECT'; id: string }
  | { type: 'SET_CONVERSATIONS'; conversations: Conversation[] }
  | { type: 'ADD_CONVERSATION'; conversation: Conversation }
  | { type: 'UPDATE_CONVERSATION'; id: string; updates: Partial<Conversation> }
  | { type: 'REMOVE_CONVERSATION'; id: string }
  | { type: 'ADD_MESSAGE_TO_CONVERSATION'; id: string; message: Message }
  | { type: 'SET_CONVERSATION_MESSAGES'; id: string; messages: Message[] }
  | { type: 'SET_ACTIVE_CONV_ID'; id: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_HYDRATED'; hydrated: boolean }
  | { type: 'SET_SERVER_BACKED'; backed: boolean }
  | { type: 'SET_ABORT_CONTROLLER'; controller: AbortController | null }
  | { type: 'INCREMENT_PREVIEW_KEY' }
  | { type: 'SET_SAFE_MODE'; safeMode: boolean }
  | { type: 'SET_TASK_PLAN'; plan: string[] }
  | { type: 'SET_APPROVALS'; approvals: ApprovalRequest[] }
  | { type: 'ADD_APPROVAL'; approval: ApprovalRequest }
  | { type: 'REMOVE_APPROVAL'; approvalId: string }
  | { type: 'SET_HUMAN_CHECKPOINT'; checkpoint: HumanCheckpoint | null }
  | { type: 'SET_INTERACTIONS'; interactions: ActionCenterInteraction[] }
  | { type: 'ADD_INTERACTION'; interaction: ActionCenterInteraction }
  | { type: 'REMOVE_INTERACTION'; id: string }
  | { type: 'ADD_INTERACTION_HISTORY'; interaction: ActionCenterInteraction }
  | { type: 'SET_PROJECT_MEMORY'; memory: Record<string, unknown> }
  | { type: 'MERGE_PROJECT_MEMORY'; memory: Record<string, unknown> }
  | { type: 'SET_PLANNER_ARTIFACT'; artifact: PlannerArtifact | null }
  | { type: 'SET_EXECUTION_ARTIFACTS'; artifacts: ExecutionArtifact[] }
  | { type: 'RESET_CHAT' };

// Helper: load from localStorage
export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    return JSON.parse(saved);
  } catch {
    return fallback;
  }
}
