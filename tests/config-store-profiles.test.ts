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
  }

  return { default: MockStore };
});

import { ConfigStore } from '../src/main/config/config-store';

describe('ConfigStore provider projections', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('keeps provider-specific credentials isolated when switching active provider', () => {
    const store = new ConfigStore();

    store.update({ provider: 'openrouter', apiKey: 'sk-openrouter', model: 'anthropic/claude-sonnet-4-6' });
    store.update({ provider: 'openai', apiKey: 'sk-openai', model: 'gpt-5.4' });

    const openaiView = store.getAll();
    expect(openaiView.provider).toBe('openai');
    expect(openaiView.apiKey).toBe('sk-openai');
    expect(openaiView.providers.openrouter?.apiKey).toBe('sk-openrouter');

    store.setActiveProvider({ profileKey: 'openrouter' });
    const openrouterView = store.getAll();
    expect(openrouterView.provider).toBe('openrouter');
    expect(openrouterView.apiKey).toBe('sk-openrouter');
  });

  it('reports configured state when any provider has usable credentials', () => {
    const store = new ConfigStore();

    store.saveProvider({
      profileKey: 'custom:anthropic',
      config: {
        provider: 'custom',
        customProtocol: 'anthropic',
        apiKey: 'sk-custom',
        baseUrl: 'https://example.test/anthropic',
        defaultModel: 'glm-5',
        models: [{ id: 'glm-5', label: 'glm-5', source: 'preset' }],
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    });

    expect(store.hasAnyUsableCredentials()).toBe(true);
    expect(store.isConfigured()).toBe(true);
  });
});

