import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

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
    public path = '/tmp/mock-session-manager-cache-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
      };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
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

function makeDb() {
  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  };
}

function userEntry(id: string, text: string): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: '2026-08-29T00:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 },
  } as SessionEntry;
}

describe('SessionManager message cache', () => {
  it('reads from entriesReader, caches, and appends saved messages without re-reading', () => {
    const db = makeDb();
    const manager = new SessionManager(db as unknown as DatabaseInstance, vi.fn());
    const reader = vi.fn(() => [userEntry('m1', 'hello')]);
    manager.setEntriesReader(reader);

    const first = manager.getMessages('s1');
    const second = manager.getMessages('s1');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(reader).toHaveBeenCalledTimes(1);

    manager.saveMessage({
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      content: [{ type: 'text', text: 'world' }],
      timestamp: 2,
    });

    const third = manager.getMessages('s1');
    expect(third).toHaveLength(2);
    expect(third[1].id).toBe('m2');
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('does not serve a partial cache seeded by saveMessage before a full load', () => {
    const db = makeDb();
    const manager = new SessionManager(db as unknown as DatabaseInstance, vi.fn());
    const reader = vi.fn(() => []); // empty entries
    manager.setEntriesReader(reader);

    // Save a message for session 's2' which is not yet cached
    manager.saveMessage({
      id: 'msg-a',
      sessionId: 's2',
      role: 'user',
      content: [{ type: 'text', text: 'first' }],
      timestamp: 10,
    });

    // saveMessage only seeds a partial [message] cache; a session is served
    // from cache only after a full getMessages() load, so the reader is
    // consulted here (returns empty).
    const msgs = manager.getMessages('s2');
    expect(msgs).toHaveLength(0);
    expect(reader).toHaveBeenCalledTimes(1);

    // After a full load the cache is complete; further getMessages calls
    // are served from cache without consulting the reader.
    manager.getMessages('s2');
    expect(reader).toHaveBeenCalledTimes(1);

    // Saving another message appends to the complete cache
    manager.saveMessage({
      id: 'msg-b',
      sessionId: 's2',
      role: 'assistant',
      content: [{ type: 'text', text: 'reply' }],
      timestamp: 20,
    });
    const msgs2 = manager.getMessages('s2');
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0].id).toBe('msg-b');
    expect(reader).toHaveBeenCalledTimes(1);
  });
});
