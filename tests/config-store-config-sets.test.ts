import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
        ...mocks.seed,
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
      this.store = { ...this.store, ...key };
    }

    clear(): void {
      this.store = {};
    }
  }

  return { default: MockStore };
});

import { ConfigStore } from '../src/main/config/config-store';

describe('ConfigStore provider configs', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('seeds a provider map from flat fields when providers are missing', () => {
    const store = new ConfigStore();
    store.update({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      isConfigured: true,
    });
    const config = store.getAll();

    expect(config.activeProviderKey).toBe('openai');
    expect(config.providers.openai?.apiKey).toBe('sk-openai');
    expect(config.providers.openai?.defaultModel).toBe('gpt-5.3-codex');
    expect(config.model).toBe('gpt-5.3-codex');
  });

  it('uses preset runtime defaults for preset providers and ignores custom model payloads', () => {
    const store = new ConfigStore();

    store.saveProvider({
      profileKey: 'openai',
      config: {
        provider: 'openai',
        customProtocol: 'openai',
        apiKey: 'sk-openai',
        baseUrl: 'https://example.test/v1',
        defaultModel: 'gpt-5.4-mini',
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', source: 'preset' },
          { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', source: 'preset' },
        ],
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    });
    const saved = store.setActiveProvider({ profileKey: 'openai' });

    expect(saved.providers.openai?.models).toHaveLength(0);
    expect(saved.providers.openai?.baseUrl).toBe('https://api.openai.com/v1');
    expect(saved.providers.openai?.defaultModel).toBe('gpt-5.3-codex');
    expect(saved.model).toBe('gpt-5.3-codex');
  });

  it('clears preset provider credentials instead of removing the slot', () => {
    const store = new ConfigStore();

    store.saveProvider({
      profileKey: 'openai',
      config: {
        provider: 'openai',
        customProtocol: 'openai',
        apiKey: 'sk-openai',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-5.4',
        models: [{ id: 'gpt-5.4', label: 'gpt-5.4', source: 'preset' }],
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    });

    const deleted = store.deleteProvider({ profileKey: 'openai' });

    expect(deleted.providers.openai?.apiKey).toBe('');
    expect(deleted.providers.openai?.baseUrl).toBe('https://api.openai.com/v1');
    expect(deleted.providers.openai?.defaultModel).toBe('gpt-5.3-codex');
  });

  it('updates top-level runtime model when changing the custom provider default model', () => {
    const store = new ConfigStore();

    store.saveProvider({
      profileKey: 'custom:openai',
      config: {
        provider: 'custom',
        customProtocol: 'openai',
        apiKey: 'sk-custom',
        baseUrl: 'https://example.test/v1',
        defaultModel: 'model-a',
        models: [
          { id: 'model-a', label: 'model-a', source: 'custom', contextWindow: 65536, maxTokens: 8192 },
          { id: 'model-b', label: 'model-b', source: 'custom', contextWindow: 131072, maxTokens: 4096 },
        ],
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    });

    const switched = store.setActiveProvider({
      profileKey: 'custom:openai',
      defaultModel: 'model-b',
    });

    expect(switched.model).toBe('model-b');
    expect(switched.contextWindow).toBe(131072);
    expect(switched.maxTokens).toBe(4096);
  });

  it('keeps theme preference across provider mutations', () => {
    mocks.seed = { theme: 'dark' };
    const store = new ConfigStore();

    store.saveProvider({
      profileKey: 'anthropic',
      config: {
        provider: 'anthropic',
        customProtocol: 'anthropic',
        apiKey: 'sk-ant',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-6',
        models: [{ id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', source: 'preset' }],
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    });

    expect(store.get('theme')).toBe('dark');
  });
});
