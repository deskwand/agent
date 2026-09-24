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
    // The provided model is a preset model id, so it is adopted as the
    // provider default (preset models are no longer stripped away).
    expect(config.providers.openai?.defaultModel).toBe('gpt-5.4');
    expect(config.model).toBe('gpt-5.4');
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

    expect(saved.providers.openai?.models).toHaveLength(7);
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

  it.each([
    [
      "custom:subscription-bailian-coding",
      "https://coding.dashscope.aliyuncs.com/v1",
      "qwen3.7-plus",
    ],
    [
      "custom:subscription-ark-coding",
      "https://ark.cn-beijing.volces.com/api/coding/v3",
      "ark-code-latest",
    ],
  ])(
    "pins %s to its subscription endpoint and model list",
    (profileKey, baseUrl, defaultModel) => {
      const store = new ConfigStore();
      const saved = store.saveProvider({
        profileKey,
        config: {
          provider: "custom",
          customProtocol: "anthropic",
          name: "Forged",
          apiKey: " subscribed-key ",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "unauthorized-model",
          models: [
            { id: "unauthorized-model", label: "bad", source: "custom" },
          ],
          updatedAt: "",
        },
      });
      const profile = saved.providers[profileKey]!;
      expect(profile.provider).toBe("custom");
      expect(profile.customProtocol).toBe("openai");
      expect(profile.baseUrl).toBe(baseUrl);
      expect(profile.defaultModel).toBe(defaultModel);
      expect(profile.models.map((m) => m.id)).toContain(defaultModel);
      expect(profile.models.map((m) => m.id)).not.toContain(
        "unauthorized-model",
      );
      expect(profile.apiKey).toBe("subscribed-key");
      expect(
        store.deleteProvider({ profileKey }).providers[profileKey],
      ).toBeUndefined();
    },
  );

  it("canonicalizes tampered stored subscription configuration on projection", () => {
    const profileKey = "custom:subscription-bailian-coding";
    const store = new ConfigStore();
    store.saveProvider({
      profileKey,
      config: {
        provider: "custom",
        customProtocol: "openai",
        apiKey: "sk-sp-key",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        defaultModel: "kimi-k2.5",
        models: [{ id: "kimi-k2.5", label: "kimi-k2.5", source: "preset" }],
        updatedAt: "",
      },
    });
    const stored = (
      store as unknown as {
        store: { store: { providers: Record<string, { baseUrl: string }> } };
      }
    ).store.store;
    stored.providers[profileKey].baseUrl = "https://api.openai.com/v1";
    const projected = store.getAll().providers[profileKey]!;
    expect(projected.baseUrl).toBe("https://coding.dashscope.aliyuncs.com/v1");
    expect(projected.defaultModel).toBe("kimi-k2.5");
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
