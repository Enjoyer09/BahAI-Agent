// ==========================================
// API Client Tests
// ==========================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  loadWorkspaceState,
  createProjectOnServer,
  updateProjectOnServer,
  deleteProjectOnServer,
  createConversationOnServer,
  updateConversationOnServer,
  deleteConversationOnServer,
  getInteractions,
  getTaskPlan,
  previewDiff,
  applyDiff,
  submitApproval,
  getGithubStatus,
  connectGithub,
  disconnectGithub,
  listGithubRepos,
  getProjectMemory,
  saveProjectMemory,
} from './api';
import type { SSEEvent } from './types';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function mockResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// Mock SSE response
function mockSSEResponse(events: SSEEvent[]): Response {
  const body = events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
  });

  // ========== loadWorkspaceState ==========
  describe('loadWorkspaceState', () => {
    it('returns projects and conversations on success', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({
          projects: [{ id: 'p1', name: 'Test', path: '/test', createdAt: 1000 }],
        }))
        .mockResolvedValueOnce(mockResponse({
          conversations: [{ id: 'c1', projectId: 'p1', title: 'Chat', messages: [], createdAt: 1000, updatedAt: 1000 }],
        }));

      const result = await loadWorkspaceState();
      expect(result.projects).toHaveLength(1);
      expect(result.conversations).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on non-ok response', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ error: 'Not found' }, 404))
        .mockResolvedValueOnce(mockResponse({ conversations: [] }, 200));
      await expect(loadWorkspaceState()).rejects.toThrow('Workspace məlumatları yüklənmədi');
    });
  });

  // ========== createProjectOnServer ==========
  describe('createProjectOnServer', () => {
    it('sends POST and returns project + conversation', async () => {
      const responseData = {
        project: { id: 'p1', name: 'New', path: '/new', createdAt: 1000 },
        conversation: { id: 'c1', projectId: 'p1', title: 'Chat', messages: [], createdAt: 1000, updatedAt: 1000 },
      };
      mockFetch.mockResolvedValueOnce(mockResponse(responseData));

      const result = await createProjectOnServer({ name: 'New', path: '/new' });
      expect(result.project.name).toBe('New');
      expect(result.conversation.projectId).toBe('p1');
    });
  });

  // ========== updateProjectOnServer ==========
  describe('updateProjectOnServer', () => {
    it('sends PATCH and returns updated project', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ project: { id: 'p1', name: 'Updated', path: '/p', createdAt: 1000 } }));

      const result = await updateProjectOnServer('p1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
      expect(mockFetch.mock.calls[0][1]?.method).toBe('PATCH');
    });
  });

  // ========== deleteProjectOnServer ==========
  describe('deleteProjectOnServer', () => {
    it('sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 200));
      await deleteProjectOnServer('p1');
      expect(mockFetch.mock.calls[0][1]?.method).toBe('DELETE');
    });
  });

  // ========== createConversationOnServer ==========
  describe('createConversationOnServer', () => {
    it('sends POST and returns conversation', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        conversation: { id: 'c1', projectId: 'p1', title: 'Yeni söhbət', messages: [], createdAt: 1000, updatedAt: 1000 },
      }));

      const result = await createConversationOnServer('p1');
      expect(result.id).toBe('c1');
    });
  });

  // ========== updateConversationOnServer ==========
  describe('updateConversationOnServer', () => {
    it('sends PATCH and returns updated conversation', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        conversation: { id: 'c1', projectId: 'p1', title: 'Updated', messages: [], createdAt: 1000, updatedAt: 1000 },
      }));

      const result = await updateConversationOnServer('c1', { title: 'Updated' });
      expect(result.title).toBe('Updated');
    });
  });

  // ========== deleteConversationOnServer ==========
  describe('deleteConversationOnServer', () => {
    it('sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 200));
      await deleteConversationOnServer('c1');
      expect(mockFetch.mock.calls[0][1]?.method).toBe('DELETE');
    });
  });

  // ========== getInteractions ==========
  describe('getInteractions', () => {
    it('returns interactions array from response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        interactions: [{ id: 'i1', kind: 'approval' }],
      }));

      const result = await getInteractions();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('i1');
    });

    it('returns empty array when no interactions field', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));
      const result = await getInteractions();
      expect(result).toEqual([]);
    });
  });

  // ========== getTaskPlan ==========
  describe('getTaskPlan', () => {
    it('maps plan items to array of strings', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        plan: [{ title: 'Step 1' }, { title: 'Step 2' }],
      }));

      const result = await getTaskPlan('test prompt', '/workspace');
      expect(result.items).toEqual(['Step 1', 'Step 2']);
    });
  });

  // ========== previewDiff / applyDiff ==========
  describe('previewDiff', () => {
    it('returns diff string', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ diff: '--- a/file\n+++ b/file\n+new line' }));

      const result = await previewDiff({ path: 'file.ts', workingDirectory: '/wd', newContent: 'new' });
      expect(result.diff).toContain('+new line');
    });
  });

  describe('applyDiff', () => {
    it('succeeds on 200', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 200));
      await expect(applyDiff({ path: 'f.ts', workingDirectory: '/wd', newContent: 'c' })).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'fail' }, 500));
      await expect(applyDiff({ path: 'f.ts', workingDirectory: '/wd', newContent: 'c' })).rejects.toThrow();
    });
  });

  // ========== submitApproval ==========
  describe('submitApproval', () => {
    it('sends POST with decision', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 200));
      await submitApproval('a1', 'approve');
      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.decision).toBe('approve');
    });
  });

  // ========== GitHub endpoints ==========
  describe('getGithubStatus', () => {
    it('returns status', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ connected: true, username: 'testuser' }));
      const result = await getGithubStatus();
      expect(result.connected).toBe(true);
      expect(result.username).toBe('testuser');
    });
  });

  describe('connectGithub', () => {
    it('sends POST with token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ connected: true, username: 'test' }));
      const result = await connectGithub('ghp_token');
      expect(result.connected).toBe(true);
    });
  });

  describe('disconnectGithub', () => {
    it('sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 200));
      await disconnectGithub();
      expect(mockFetch.mock.calls[0][1]?.method).toBe('DELETE');
    });
  });

  describe('listGithubRepos', () => {
    it('returns repos array', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        repos: [{ name: 'repo1', fullName: 'user/repo1', private: false, url: 'https://github.com/user/repo1', description: null }],
      }));
      const result = await listGithubRepos();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('repo1');
    });
  });

  // ========== Project Memory ==========
  describe('getProjectMemory', () => {
    it('returns memory object', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ memory: { key: 'value' } }));
      const result = await getProjectMemory('p1');
      expect(result).toEqual({ key: 'value' });
    });

    it('returns empty object when no memory field', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));
      const result = await getProjectMemory('p1');
      expect(result).toEqual({});
    });
  });

  describe('saveProjectMemory', () => {
    it('sends POST with memory', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 200));
      await saveProjectMemory('p1', { key: 'value' });
      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.memory.key).toBe('value');
    });
  });

  // ========== sendChatMessage (SSE) ==========
  describe('sendChatMessage', () => {
    it('parses SSE events and calls onEvent', async () => {
      // Dynamic import to avoid top-level issues with the mock
      const apiModule = await import('./api');
      const events: SSEEvent[] = [
        { type: 'orchestration_state', runId: 'r1', workflow: 'solo', mode: 'solo', agents: ['agent1'] },
        { type: 'tool_execution', tool: 'read_file', args: '{}' },
        { type: 'tool_result', result: 'file content' },
        { type: 'assistant_message', message: { content: 'Done' } },
      ];
      mockFetch.mockResolvedValueOnce(mockSSEResponse(events));

      const onEvent = vi.fn();
      await apiModule.sendChatMessage(
        [{ role: 'user', content: 'hello' }],
        'key', 'http://localhost:3001', 'model-x', '/workspace',
        { safeMode: false },
        onEvent,
      );

      expect(onEvent).toHaveBeenCalledTimes(4);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'orchestration_state' }));
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant_message' }));
    });

    it('throws on 401', async () => {
      const apiModule = await import('./api');
      mockFetch.mockResolvedValueOnce(mockResponse({}, 401));
      await expect(
        apiModule.sendChatMessage(
          [{ role: 'user', content: 'hi' }],
          'key', 'url', 'model', '/wd', { safeMode: false },
          vi.fn(),
        ),
      ).rejects.toThrow('Giriş tələb olunur');
    });
  });
});
