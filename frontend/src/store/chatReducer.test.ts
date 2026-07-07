// ==========================================
// chatReducer Tests
// ==========================================

import { describe, expect, it } from 'vitest';
import { chatReducer } from './chatReducer';
import type { ChatState } from './chatState';
import type { Project, Conversation, Message, ApprovalRequest, HumanCheckpoint, ActionCenterInteraction, PlannerArtifact, ExecutionArtifact } from '../lib/types';

function createBaseState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    projects: [],
    conversations: [],
    activeConvId: null,
    loading: false,
    hydrated: true,
    serverBacked: false,
    abortController: null,
    previewKey: 0,
    safeMode: false,
    taskPlan: [],
    pendingApprovals: [],
    humanCheckpoint: null,
    actionCenterInteractions: [],
    actionCenterHistory: [],
    projectMemory: {},
    plannerArtifact: null,
    executionArtifacts: [],
    ...overrides,
  };
}

const sampleProject: Project = {
  id: 'proj1', name: 'Test', path: '/tmp/test', createdAt: 1000,
};

const sampleConv: Conversation = {
  id: 'conv1', projectId: 'proj1', title: 'Test Chat',
  messages: [], createdAt: 1000, updatedAt: 1000,
};

const sampleMsg: Message = {
  id: 'msg1', role: 'user', content: 'hello', timestamp: 2000,
};

describe('chatReducer', () => {
  // ========== Projects ==========
  describe('SET_PROJECTS', () => {
    it('replaces the projects array', () => {
      const state = createBaseState();
      const next = chatReducer(state, { type: 'SET_PROJECTS', projects: [sampleProject] });
      expect(next.projects).toHaveLength(1);
      expect(next.projects[0].id).toBe('proj1');
    });
  });

  describe('ADD_PROJECT', () => {
    it('appends a project to the list', () => {
      const state = createBaseState({ projects: [sampleProject] });
      const p2: Project = { id: 'proj2', name: 'P2', path: '/p2', createdAt: 2000 };
      const next = chatReducer(state, { type: 'ADD_PROJECT', project: p2 });
      expect(next.projects).toHaveLength(2);
      expect(next.projects[1].id).toBe('proj2');
    });
  });

  describe('UPDATE_PROJECT', () => {
    it('merges updates into the matching project', () => {
      const state = createBaseState({ projects: [sampleProject] });
      const next = chatReducer(state, { type: 'UPDATE_PROJECT', id: 'proj1', updates: { name: 'Updated' } });
      expect(next.projects[0].name).toBe('Updated');
      expect(next.projects[0].path).toBe('/tmp/test'); // unchanged
    });

    it('does nothing if id does not match', () => {
      const state = createBaseState({ projects: [sampleProject] });
      const next = chatReducer(state, { type: 'UPDATE_PROJECT', id: 'nonexistent', updates: { name: 'X' } });
      expect(next.projects).toHaveLength(1);
      expect(next.projects[0].name).toBe('Test');
    });
  });

  describe('REMOVE_PROJECT', () => {
    it('removes the project and its conversations', () => {
      const state = createBaseState({
        projects: [sampleProject, { id: 'proj2', name: 'P2', path: '/p2', createdAt: 2000 }],
        conversations: [sampleConv, { id: 'conv2', projectId: 'proj2', title: 'C2', messages: [], createdAt: 3000, updatedAt: 3000 }],
      });
      const next = chatReducer(state, { type: 'REMOVE_PROJECT', id: 'proj1' });
      expect(next.projects).toHaveLength(1);
      expect(next.projects[0].id).toBe('proj2');
      expect(next.conversations).toHaveLength(1);
      expect(next.conversations[0].id).toBe('conv2');
    });
  });

  // ========== Conversations ==========
  describe('SET_CONVERSATIONS', () => {
    it('replaces conversations', () => {
      const next = chatReducer(createBaseState(), { type: 'SET_CONVERSATIONS', conversations: [sampleConv] });
      expect(next.conversations).toHaveLength(1);
    });
  });

  describe('ADD_CONVERSATION', () => {
    it('prepends a conversation', () => {
      const state = createBaseState({ conversations: [sampleConv] });
      const c2: Conversation = { id: 'conv2', projectId: 'proj1', title: 'C2', messages: [], createdAt: 3000, updatedAt: 3000 };
      const next = chatReducer(state, { type: 'ADD_CONVERSATION', conversation: c2 });
      expect(next.conversations).toHaveLength(2);
      expect(next.conversations[0].id).toBe('conv2');
    });
  });

  describe('UPDATE_CONVERSATION', () => {
    it('merges updates', () => {
      const state = createBaseState({ conversations: [sampleConv] });
      const next = chatReducer(state, { type: 'UPDATE_CONVERSATION', id: 'conv1', updates: { title: 'New Title' } });
      expect(next.conversations[0].title).toBe('New Title');
    });
  });

  describe('REMOVE_CONVERSATION', () => {
    it('removes by id', () => {
      const state = createBaseState({ conversations: [sampleConv] });
      const next = chatReducer(state, { type: 'REMOVE_CONVERSATION', id: 'conv1' });
      expect(next.conversations).toHaveLength(0);
    });
  });

  // ========== Messages ==========
  describe('ADD_MESSAGE_TO_CONVERSATION', () => {
    it('appends a message to the target conversation', () => {
      const state = createBaseState({ conversations: [sampleConv] });
      const next = chatReducer(state, { type: 'ADD_MESSAGE_TO_CONVERSATION', id: 'conv1', message: sampleMsg });
      expect(next.conversations[0].messages).toHaveLength(1);
      expect(next.conversations[0].messages[0].content).toBe('hello');
    });

    it('does not modify non-matching conversations', () => {
      const state = createBaseState({ conversations: [sampleConv, { ...sampleConv, id: 'conv2' }] });
      const next = chatReducer(state, { type: 'ADD_MESSAGE_TO_CONVERSATION', id: 'conv1', message: sampleMsg });
      expect(next.conversations[1].messages).toHaveLength(0);
    });
  });

  describe('SET_CONVERSATION_MESSAGES', () => {
    it('replaces messages', () => {
      const state = createBaseState({ conversations: [sampleConv] });
      const msgs = [sampleMsg, { ...sampleMsg, id: 'msg2', content: 'world' }];
      const next = chatReducer(state, { type: 'SET_CONVERSATION_MESSAGES', id: 'conv1', messages: msgs });
      expect(next.conversations[0].messages).toHaveLength(2);
    });
  });

  // ========== Active Conv / Loading / Hydrated ==========
  describe('SET_ACTIVE_CONV_ID', () => {
    it('sets the active conversation id', () => {
      const next = chatReducer(createBaseState(), { type: 'SET_ACTIVE_CONV_ID', id: 'conv1' });
      expect(next.activeConvId).toBe('conv1');
    });

    it('can set to null', () => {
      const state = createBaseState({ activeConvId: 'conv1' });
      const next = chatReducer(state, { type: 'SET_ACTIVE_CONV_ID', id: null });
      expect(next.activeConvId).toBeNull();
    });
  });

  describe('SET_LOADING / SET_HYDRATED / SET_SERVER_BACKED', () => {
    it('toggles loading', () => {
      expect(chatReducer(createBaseState(), { type: 'SET_LOADING', loading: true }).loading).toBe(true);
      expect(chatReducer(createBaseState({ loading: true }), { type: 'SET_LOADING', loading: false }).loading).toBe(false);
    });

    it('toggles hydrated', () => {
      expect(chatReducer(createBaseState(), { type: 'SET_HYDRATED', hydrated: false }).hydrated).toBe(false);
    });

    it('toggles serverBacked', () => {
      expect(chatReducer(createBaseState(), { type: 'SET_SERVER_BACKED', backed: true }).serverBacked).toBe(true);
    });
  });

  // ========== Abort Controller ==========
  describe('SET_ABORT_CONTROLLER', () => {
    it('stores the controller', () => {
      const ctrl = new AbortController();
      const next = chatReducer(createBaseState(), { type: 'SET_ABORT_CONTROLLER', controller: ctrl });
      expect(next.abortController).toBe(ctrl);
    });

    it('can set to null', () => {
      const next = chatReducer(createBaseState(), { type: 'SET_ABORT_CONTROLLER', controller: null });
      expect(next.abortController).toBeNull();
    });
  });

  // ========== Preview Key ==========
  describe('INCREMENT_PREVIEW_KEY', () => {
    it('increments by 1', () => {
      const next = chatReducer(createBaseState({ previewKey: 5 }), { type: 'INCREMENT_PREVIEW_KEY' });
      expect(next.previewKey).toBe(6);
    });
  });

  // ========== Safe Mode ==========
  describe('SET_SAFE_MODE', () => {
    it('sets safeMode', () => {
      const next = chatReducer(createBaseState(), { type: 'SET_SAFE_MODE', safeMode: true });
      expect(next.safeMode).toBe(true);
    });
  });

  // ========== Task Plan ==========
  describe('SET_TASK_PLAN', () => {
    it('replaces the plan', () => {
      const plan = ['Step 1', 'Step 2'];
      const next = chatReducer(createBaseState(), { type: 'SET_TASK_PLAN', plan });
      expect(next.taskPlan).toEqual(plan);
    });
  });

  // ========== Approvals ==========
  describe('SET_APPROVALS', () => {
    it('replaces pending approvals', () => {
      const approvals: ApprovalRequest[] = [{ approvalId: 'a1', tool: 'write_file', args: '{}' }];
      const next = chatReducer(createBaseState(), { type: 'SET_APPROVALS', approvals });
      expect(next.pendingApprovals).toHaveLength(1);
    });
  });

  describe('ADD_APPROVAL', () => {
    it('appends an approval', () => {
      const state = createBaseState();
      const a1: ApprovalRequest = { approvalId: 'a1', tool: 'write_file', args: '{}' };
      const next = chatReducer(state, { type: 'ADD_APPROVAL', approval: a1 });
      expect(next.pendingApprovals).toHaveLength(1);
    });
  });

  describe('REMOVE_APPROVAL', () => {
    it('removes by approvalId', () => {
      const a1: ApprovalRequest = { approvalId: 'a1', tool: 'write_file', args: '{}' };
      const state = createBaseState({ pendingApprovals: [a1] });
      const next = chatReducer(state, { type: 'REMOVE_APPROVAL', approvalId: 'a1' });
      expect(next.pendingApprovals).toHaveLength(0);
    });
  });

  // ========== Human Checkpoint ==========
  describe('SET_HUMAN_CHECKPOINT', () => {
    it('sets the checkpoint', () => {
      const cp: HumanCheckpoint = { id: 'cp1', kind: 'login', title: 'Login', message: 'Please login', resumePrompt: 'done' };
      const next = chatReducer(createBaseState(), { type: 'SET_HUMAN_CHECKPOINT', checkpoint: cp });
      expect(next.humanCheckpoint?.id).toBe('cp1');
    });

    it('can clear the checkpoint', () => {
      const cp: HumanCheckpoint = { id: 'cp1', kind: 'login', title: 'Login', message: 'Please login', resumePrompt: 'done' };
      const state = createBaseState({ humanCheckpoint: cp });
      const next = chatReducer(state, { type: 'SET_HUMAN_CHECKPOINT', checkpoint: null });
      expect(next.humanCheckpoint).toBeNull();
    });
  });

  // ========== Interactions ==========
  describe('SET_INTERACTIONS', () => {
    it('replaces interactions', () => {
      const items: ActionCenterInteraction[] = [{ id: 'i1', kind: 'approval' }];
      const next = chatReducer(createBaseState(), { type: 'SET_INTERACTIONS', interactions: items });
      expect(next.actionCenterInteractions).toHaveLength(1);
    });
  });

  describe('ADD_INTERACTION', () => {
    it('adds or replaces an interaction by id', () => {
      const state = createBaseState({ actionCenterInteractions: [{ id: 'i1', kind: 'approval' }] });
      const updated = { id: 'i1', kind: 'approval' as const, approval: { approvalId: 'a1', tool: 'x', args: '{}' } };
      const next = chatReducer(state, { type: 'ADD_INTERACTION', interaction: updated });
      expect(next.actionCenterInteractions).toHaveLength(1);
      expect(next.actionCenterInteractions[0]).toHaveProperty('approval');
    });
  });

  describe('REMOVE_INTERACTION', () => {
    it('removes by id', () => {
      const state = createBaseState({ actionCenterInteractions: [{ id: 'i1', kind: 'approval' }] });
      const next = chatReducer(state, { type: 'REMOVE_INTERACTION', id: 'i1' });
      expect(next.actionCenterInteractions).toHaveLength(0);
    });
  });

  describe('ADD_INTERACTION_HISTORY', () => {
    it('prepends and caps at 12', () => {
      const existing = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, kind: 'approval' as const }));
      const state = createBaseState({ actionCenterHistory: existing });
      const next = chatReducer(state, { type: 'ADD_INTERACTION_HISTORY', interaction: { id: 'new', kind: 'approval' } });
      expect(next.actionCenterHistory).toHaveLength(12);
      expect(next.actionCenterHistory[0].id).toBe('new');
    });
  });

  // ========== Project Memory ==========
  describe('SET_PROJECT_MEMORY', () => {
    it('replaces the memory object', () => {
      const mem = { key: 'value' };
      const next = chatReducer(createBaseState(), { type: 'SET_PROJECT_MEMORY', memory: mem });
      expect(next.projectMemory).toEqual(mem);
    });
  });

  describe('MERGE_PROJECT_MEMORY', () => {
    it('shallow-merges into existing memory', () => {
      const state = createBaseState({ projectMemory: { existing: 'keep' } });
      const next = chatReducer(state, { type: 'MERGE_PROJECT_MEMORY', memory: { added: 'new' } });
      expect(next.projectMemory.existing).toBe('keep');
      expect(next.projectMemory.added).toBe('new');
    });
  });

  // ========== Planner Artifact ==========
  describe('SET_PLANNER_ARTIFACT', () => {
    it('sets the artifact', () => {
      const artifact: PlannerArtifact = {
        goal: 'Test', filesToInspect: [], suspectedRisks: [], implementationSteps: [],
        verificationSteps: [], workUnits: [], summary: 'test',
      };
      const next = chatReducer(createBaseState(), { type: 'SET_PLANNER_ARTIFACT', artifact });
      expect(next.plannerArtifact?.goal).toBe('Test');
    });

    it('can set to null', () => {
      const next = chatReducer(createBaseState(), { type: 'SET_PLANNER_ARTIFACT', artifact: null });
      expect(next.plannerArtifact).toBeNull();
    });
  });

  // ========== Execution Artifacts ==========
  describe('SET_EXECUTION_ARTIFACTS', () => {
    it('replaces the array', () => {
      const artifacts: ExecutionArtifact[] = [{ role: 'coder', summary: 'did stuff', toolNames: ['write_file'], timestamp: 1000 }];
      const next = chatReducer(createBaseState(), { type: 'SET_EXECUTION_ARTIFACTS', artifacts });
      expect(next.executionArtifacts).toHaveLength(1);
    });
  });

  // ========== RESET_CHAT ==========
  describe('RESET_CHAT', () => {
    it('resets all fields to initial values (preserving safeMode)', () => {
      const state = createBaseState({
        projects: [sampleProject],
        conversations: [sampleConv],
        activeConvId: 'conv1',
        loading: true,
        safeMode: true,
        taskPlan: ['step'],
      });
      const next = chatReducer(state, { type: 'RESET_CHAT' });
      expect(next.projects).toHaveLength(0);
      expect(next.conversations).toHaveLength(0);
      expect(next.activeConvId).toBeNull();
      expect(next.loading).toBe(false);
      expect(next.safeMode).toBe(true); // preserved
      expect(next.taskPlan).toHaveLength(0);
    });
  });

  // ========== Default (unknown action) ==========
  describe('default case', () => {
    it('returns the current state for unknown actions', () => {
      const state = createBaseState({ loading: true });
      const next = chatReducer(state, { type: 'UNKNOWN' as any });
      expect(next).toBe(state);
    });
  });
});
