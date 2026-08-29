import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-session-manager-crud-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock('../src/main/agent/agent-runner', () => ({
  AgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

// Shared minimal DB factory used across tests
function makeDb(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
    ...overrides,
  } as unknown as DatabaseInstance;
}

// ------------------------------------------------------------------
// listSessions
// ------------------------------------------------------------------
describe('SessionManager.listSessions', () => {
  it('returns empty sessions when database is empty', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    // listSessions returns a grouped result object (sessions + contextWindows + goalStatuses)
    const result = manager.listSessions();
    expect(result.sessions).toEqual([]);
    expect(result.contextWindows).toEqual({});
    expect(result.goalStatuses).toEqual({});
    expect(db.sessions.getAll).toHaveBeenCalledTimes(1);
  });

  it('maps database rows to Session objects', () => {
    const row = {
      id: 's1',
      title: 'My Session',
      deskwand_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: '/tmp/workspace',
      mounted_paths: JSON.stringify([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]),
      allowed_tools: JSON.stringify(['read', 'write']),
      memory_enabled: 0,
      model: 'claude-3-5-sonnet',
      created_at: 1000,
      updated_at: 2000,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const { sessions } = manager.listSessions();

    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.id).toBe('s1');
    expect(s.title).toBe('My Session');
    expect(s.cwd).toBe('/tmp/workspace');
    expect(s.mountedPaths).toEqual([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]);
    expect(s.allowedTools).toEqual(['read', 'write']);
    expect(s.memoryEnabled).toBe(false);
    expect(s.model).toBe('claude-3-5-sonnet');
    expect(s.createdAt).toBe(1000);
    expect(s.updatedAt).toBe(2000);
  });

  it('falls back to empty arrays when mounted_paths or allowed_tools JSON is malformed', () => {
    const row = {
      id: 's2',
      title: 'Broken JSON',
      deskwand_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: null,
      mounted_paths: '{{{broken',
      allowed_tools: '[unclosed',
      memory_enabled: 0,
      model: null,
      created_at: 1,
      updated_at: 1,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [s] = manager.listSessions().sessions;

    expect(s.mountedPaths).toEqual([]);
    expect(s.allowedTools).toEqual([]);
  });
});

// ------------------------------------------------------------------
describe('SessionManager.handlePermissionResponse', () => {
  it('resolves the pending permission promise with the given result', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    // Inject a fake pending permission via requestPermission
    const permissionPromise = manager.requestPermission('s1', 'tool-1', 'bash', { command: 'ls' });

    // Synchronously resolve it
    manager.handlePermissionResponse('tool-1', 'allow');

    const result = await permissionPromise;
    expect(result).toBe('allow');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    // Should not throw
    expect(() => manager.handlePermissionResponse('nonexistent', 'deny')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// handleSudoPasswordResponse
// ------------------------------------------------------------------
describe('SessionManager.handleSudoPasswordResponse', () => {
  it('resolves the pending sudo password promise with the given password', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    const sudoPromise = manager.requestSudoPassword('s1', 'tool-2', 'sudo apt-get update');

    manager.handleSudoPasswordResponse('tool-2', 'secret123');

    const password = await sudoPromise;
    expect(password).toBe('secret123');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(() => manager.handleSudoPasswordResponse('nonexistent', 'pw')).not.toThrow();
  });
});

