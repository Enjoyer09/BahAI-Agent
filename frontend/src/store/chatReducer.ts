// ==========================================
// Chat Reducer — Pure State Transitions
// ==========================================

import type { ChatState, ChatAction } from './chatState';

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects };

    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.project] };

    case 'UPDATE_PROJECT': {
      const { id, updates } = action;
      return {
        ...state,
        projects: state.projects.map(p => (p.id === id ? { ...p, ...updates } : p)),
      };
    }

    case 'REMOVE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter(p => p.id !== action.id),
        conversations: state.conversations.filter(c => c.projectId !== action.id),
      };

    case 'SET_CONVERSATIONS':
      return { ...state, conversations: action.conversations };

    case 'APPEND_CONVERSATIONS': {
      const merged = [...state.conversations];
      for (const incoming of action.conversations) {
        if (!merged.some((item) => item.id === incoming.id)) {
          merged.push(incoming);
        }
      }
      return { ...state, conversations: merged, conversationsHasMore: action.hasMore ?? state.conversationsHasMore };
    }

    case 'SET_CONVERSATIONS_HAS_MORE':
      return { ...state, conversationsHasMore: action.hasMore };

    case 'ADD_CONVERSATION':
      return { ...state, conversations: [action.conversation, ...state.conversations] };

    case 'UPDATE_CONVERSATION': {
      const { id, updates } = action;
      return {
        ...state,
        conversations: state.conversations.map(c =>
          c.id === id ? { ...c, ...updates } : c
        ),
      };
    }

    case 'REMOVE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter(c => c.id !== action.id),
      };

    case 'ADD_MESSAGE_TO_CONVERSATION': {
      const { id, message } = action;
      return {
        ...state,
        conversations: state.conversations.map(c =>
          c.id === id
            ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() }
            : c
        ),
      };
    }

    case 'SET_CONVERSATION_MESSAGES': {
      const { id, messages } = action;
      return {
        ...state,
        conversations: state.conversations.map(c =>
          c.id === id ? { ...c, messages, updatedAt: Date.now() } : c
        ),
      };
    }

    case 'SET_ACTIVE_CONV_ID':
      return { ...state, activeConvId: action.id };

    case 'SET_LOADING':
      return { ...state, loading: action.loading };

    case 'SET_HYDRATED':
      return { ...state, hydrated: action.hydrated };

    case 'SET_SERVER_BACKED':
      return { ...state, serverBacked: action.backed };

    case 'SET_ABORT_CONTROLLER':
      return { ...state, abortController: action.controller };

    case 'INCREMENT_PREVIEW_KEY':
      return { ...state, previewKey: state.previewKey + 1 };

    case 'SET_SAFE_MODE':
      return { ...state, safeMode: action.safeMode };

    case 'SET_TASK_PLAN':
      return { ...state, taskPlan: action.plan };

    case 'SET_APPROVALS':
      return { ...state, pendingApprovals: action.approvals };

    case 'ADD_APPROVAL':
      return { ...state, pendingApprovals: [...state.pendingApprovals, action.approval] };

    case 'REMOVE_APPROVAL':
      return {
        ...state,
        pendingApprovals: state.pendingApprovals.filter(a => a.approvalId !== action.approvalId),
      };

    case 'SET_HUMAN_CHECKPOINT':
      return { ...state, humanCheckpoint: action.checkpoint };

    case 'SET_INTERACTIONS':
      return { ...state, actionCenterInteractions: action.interactions };

    case 'ADD_INTERACTION': {
      const filtered = state.actionCenterInteractions.filter(i => i.id !== action.interaction.id);
      return {
        ...state,
        actionCenterInteractions: [...filtered, action.interaction],
      };
    }

    case 'REMOVE_INTERACTION':
      return {
        ...state,
        actionCenterInteractions: state.actionCenterInteractions.filter(i => i.id !== action.id),
      };

    case 'ADD_INTERACTION_HISTORY':
      return {
        ...state,
        actionCenterHistory: [action.interaction, ...state.actionCenterHistory].slice(0, 12),
      };

    case 'SET_PROJECT_MEMORY':
      return { ...state, projectMemory: action.memory };

    case 'MERGE_PROJECT_MEMORY':
      return {
        ...state,
        projectMemory: { ...state.projectMemory, ...action.memory },
      };

    case 'SET_PLANNER_ARTIFACT':
      return { ...state, plannerArtifact: action.artifact };

    case 'SET_EXECUTION_ARTIFACTS':
      return { ...state, executionArtifacts: action.artifacts };

    case 'RESET_CHAT':
      return {
        projects: [],
        conversations: [],
        conversationsHasMore: false,
        activeConvId: null,
        loading: false,
        hydrated: false,
        serverBacked: false,
        abortController: null,
        previewKey: 0,
        safeMode: state.safeMode,
        taskPlan: [],
        pendingApprovals: [],
        humanCheckpoint: null,
        actionCenterInteractions: [],
        actionCenterHistory: [],
        projectMemory: {},
        plannerArtifact: null,
        executionArtifacts: [],
      };

    default:
      return state;
  }
}
