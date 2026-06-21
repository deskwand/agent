import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    public path = '/tmp/mock-session-manager-title-config-store.json';

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

    clear(): void {
      this.store = {};
    }
  }

  return {
    default: MockStore,
  };
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

vi.mock('../src/main/agent/agent-sdk-one-shot', () => ({
  generateTitleWithAgentSdk: vi.fn(async () => 'Unified Title'),
}));

import { configStore } from '../src/main/config/config-store';
import { SessionManager } from '../src/main/session/session-manager';
import { generateTitleWithAgentSdk } from '../src/main/agent/agent-sdk-one-shot';

const mockedGenerateTitleWithAgentSdk = vi.mocked(generateTitleWithAgentSdk);

describe('SessionManager unified title generation', () => {
  const previous = {
    disableDeskWandUnified: process.env.COWORK_DISABLE_DeskWand_UNIFIED,
    provider: configStore.get('provider'),
    customProtocol: configStore.get('customProtocol'),
    apiKey: configStore.get('apiKey'),
    baseUrl: configStore.get('baseUrl'),
    model: configStore.get('model'),
  };

  beforeEach(() => {
    delete process.env.COWORK_DISABLE_DeskWand_UNIFIED;
    configStore.set('provider', 'openai');
    configStore.set('customProtocol', 'openai');
    configStore.set('apiKey', 'sk-test');
    configStore.set('model', 'gpt-4.1');
    mockedGenerateTitleWithAgentSdk.mockClear();
  });

  afterEach(() => {
    if (previous.disableDeskWandUnified === undefined) {
      delete process.env.COWORK_DISABLE_DeskWand_UNIFIED;
    } else {
      process.env.COWORK_DISABLE_DeskWand_UNIFIED = previous.disableDeskWandUnified;
    }
    configStore.set('provider', previous.provider);
    configStore.set('customProtocol', previous.customProtocol);
    configStore.set('apiKey', previous.apiKey);
    configStore.set('baseUrl', previous.baseUrl);
    configStore.set('model', previous.model);
    vi.restoreAllMocks();
  });

  it('routes title generation through Agent SDK in unified mode', async () => {
    const proto = SessionManager.prototype as unknown as {
      generateTitleWithConfig(titlePrompt: string): Promise<string | null>;
    };

    const title = await proto.generateTitleWithConfig.call({}, 'Please generate title');

    expect(title).toBe('Unified Title');
    expect(mockedGenerateTitleWithAgentSdk).toHaveBeenCalledTimes(1);
    expect(mockedGenerateTitleWithAgentSdk).toHaveBeenCalledWith(
      'Please generate title',
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4.1',
      })
    );
  });

  it('routes gemini title generation through Agent SDK even when unified mode flag is disabled', async () => {
    process.env.COWORK_DISABLE_DeskWand_UNIFIED = '1';
    configStore.set('provider', 'gemini');
    configStore.set('customProtocol', 'gemini');
    configStore.set('apiKey', 'AIza-test');
    configStore.set('baseUrl', 'https://generativelanguage.googleapis.com');
    configStore.set('model', 'gemini/gemini-2.5-flash');

    const proto = SessionManager.prototype as unknown as {
      generateTitleWithConfig(titlePrompt: string): Promise<string | null>;
    };

    const title = await proto.generateTitleWithConfig.call({}, 'Please generate title');

    expect(title).toBe('Unified Title');
    expect(mockedGenerateTitleWithAgentSdk).toHaveBeenCalledTimes(1);
    expect(mockedGenerateTitleWithAgentSdk).toHaveBeenCalledWith(
      'Please generate title',
      expect.objectContaining({
        provider: 'gemini',
        customProtocol: 'gemini',
        model: 'gemini-2.5-flash',
      })
    );
  });
});
