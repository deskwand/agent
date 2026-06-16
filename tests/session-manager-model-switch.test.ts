import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/renderer/types';
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
    public path = '/tmp/mock-session-model-config-store.json';

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
    run = vi.fn(async () => undefined);
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
import { configStore } from '../src/main/config/config-store';

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

function makeSession(model?: string): Session {
  return {
    id: 'session-1',
    title: 'test',
    status: 'idle',
    cwd: '/tmp',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    providerProfileKey: undefined,
    model,
    thinkingLevel: 'medium',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('SessionManager model switching', () => {
  beforeEach(() => {
    configStore.saveProvider({
      profileKey: 'openrouter',
      config: {
        provider: 'openrouter',
        customProtocol: 'anthropic',
        apiKey: '',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'anthropic/claude-sonnet-4-6',
        models: [{ id: 'anthropic/claude-sonnet-4-6', label: 'anthropic/claude-sonnet-4-6', source: 'preset' }],
        updatedAt: new Date().toISOString(),
      },
    });
    configStore.saveProvider({
      profileKey: 'deepseek',
      config: {
        provider: 'deepseek',
        customProtocol: 'openai',
        apiKey: 'sk-deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-v4-pro',
        models: [
          { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', source: 'preset' },
          { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', source: 'preset' },
        ],
        updatedAt: new Date().toISOString(),
      },
    });
    configStore.setActiveProvider({
      profileKey: 'openrouter',
      defaultModel: 'anthropic/claude-sonnet-4-6',
    });
  });

  it('does not override an existing session model during prompt processing', async () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    const session = makeSession('claude-sonnet-4-6');

    (manager as any).ensureSandboxInitialized = vi.fn(async () => undefined);
    (manager as any).processFileAttachments = vi.fn(async (_s: Session, content: any) => content);
    (manager as any).getMessages = vi.fn(() => []);
    (manager as any).saveMessage = vi.fn();
    (manager as any).runSessionTitleGeneration = vi.fn(async () => undefined);
    const runMock = vi.fn(async () => undefined);
    (manager as any).agentRunner = { run: runMock };

    expect((manager as any).resolveUniqueProviderForSessionModel('openrouter', 'deepseek-v4-pro')).toBe(
      'deepseek'
    );

    await (manager as any).processPrompt(session, 'hello');

    expect(session.model).toBe('claude-sonnet-4-6');
    expect(db.sessions.update).not.toHaveBeenCalledWith(session.id, { model: 'gpt-5.4' });
  });

  it('backfills session model from config when session model is empty', async () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    const session = makeSession(undefined);

    (manager as any).ensureSandboxInitialized = vi.fn(async () => undefined);
    (manager as any).processFileAttachments = vi.fn(async (_s: Session, content: any) => content);
    (manager as any).getMessages = vi.fn(() => []);
    (manager as any).saveMessage = vi.fn();
    (manager as any).runSessionTitleGeneration = vi.fn(async () => undefined);
    const runMock = vi.fn(async () => undefined);
    (manager as any).agentRunner = { run: runMock };

    expect((manager as any).resolveUniqueProviderForSessionModel('openrouter', 'deepseek-v4-pro')).toBe(
      'deepseek'
    );

    await (manager as any).processPrompt(session, 'hello');

    expect(session.providerProfileKey).toBe('openrouter');
    expect(session.model).toBe('anthropic/claude-sonnet-4-6');
    expect(db.sessions.update).toHaveBeenCalledWith(session.id, {
      provider_profile_key: 'openrouter',
      model: 'anthropic/claude-sonnet-4-6',
    });
  });

  it('setSessionProviderModel updates db and emits session.update', () => {
    const sendToRenderer = vi.fn();
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => ({ id: 'session-1' })),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });
    const manager = new SessionManager(db, sendToRenderer);

    manager.setSessionProviderModel('session-1', 'openai', 'gpt-5.4');

    expect(db.sessions.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ provider_profile_key: 'openai', model: 'gpt-5.4' })
    );
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: 'session.update',
      payload: {
        sessionId: 'session-1',
        updates: { providerProfileKey: 'openai', model: 'gpt-5.4' },
      },
    });
  });

  it('repairs a stale provider/model combination when the model uniquely belongs to another configured provider', async () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    const session = makeSession('deepseek-v4-pro');
    session.providerProfileKey = 'openrouter';

    (manager as any).ensureSandboxInitialized = vi.fn(async () => undefined);
    (manager as any).processFileAttachments = vi.fn(async (_s: Session, content: any) => content);
    (manager as any).getMessages = vi.fn(() => []);
    (manager as any).saveMessage = vi.fn();
    (manager as any).runSessionTitleGeneration = vi.fn(async () => undefined);
    const runMock = vi.fn(async () => undefined);
    (manager as any).agentRunner = { run: runMock };

    expect((manager as any).resolveUniqueProviderForSessionModel('openrouter', 'deepseek-v4-pro')).toBe(
      'deepseek'
    );

    await (manager as any).processPrompt(session, 'hello');

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerProfileKey: 'deepseek', model: 'deepseek-v4-pro' }),
      'hello',
      expect.any(Array)
    );
    expect(session.providerProfileKey).toBe('deepseek');
    expect(db.sessions.update).toHaveBeenCalledWith(session.id, {
      provider_profile_key: 'deepseek',
      model: 'deepseek-v4-pro',
    });
  });
});
