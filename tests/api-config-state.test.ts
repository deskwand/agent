import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/renderer/types';
import {
  FALLBACK_PROVIDER_PRESETS,
  buildApiConfigSnapshot,
  profileKeyFromProvider,
  profileKeyToProvider,
} from '../src/renderer/hooks/useApiConfigState';

describe('api config state helpers', () => {
  it('maps provider keys consistently', () => {
    expect(profileKeyFromProvider('openrouter')).toBe('openrouter');
    expect(profileKeyFromProvider('custom', 'openai')).toBe('custom:openai');
    expect(profileKeyToProvider('deepseek')).toEqual({
      provider: 'deepseek',
      customProtocol: 'openai',
    });
    expect(profileKeyToProvider('custom:gemini')).toEqual({
      provider: 'custom',
      customProtocol: 'anthropic',
    });
  });

  it('reads active model from provider configs into the snapshot', () => {
    const config = {
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: 'sk-custom',
      baseUrl: 'https://example.test/v1',
      model: 'my-model',
      activeProfileKey: 'custom:openai',
      activeProviderKey: 'custom:openai',
      profiles: {},
      providers: {
        'custom:openai': {
          provider: 'custom',
          customProtocol: 'openai',
          apiKey: 'sk-custom',
          baseUrl: 'https://example.test/v1',
          defaultModel: 'my-model',
          models: [
            {
              id: 'my-model',
              label: 'My Model',
              source: 'custom',
              contextWindow: 123456,
              maxTokens: 4096,
            },
          ],
          updatedAt: '2026-05-24T00:00:00.000Z',
        },
      },
      deskWandCodePath: '',
      defaultWorkdir: '',
      globalSkillsPath: '',
      theme: 'light',
      sandboxEnabled: false,
      memoryEnabled: true,
      memoryRuntime: {
        llm: { inheritFromActive: true, apiKey: '', baseUrl: '', model: '', timeoutMs: 180000 },
        embedding: {
          inheritFromActive: true,
          apiKey: '',
          baseUrl: '',
          model: 'text-embedding-3-small',
          timeoutMs: 180000,
        },
        useEmbedding: false,
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
      enableThinking: false,
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);

    expect(snapshot.activeProfileKey).toBe('custom:openai');
    expect(snapshot.profiles['custom:openai'].useCustomModel).toBe(true);
    expect(snapshot.profiles['custom:openai'].customModel).toBe('my-model');
    expect(snapshot.profiles['custom:openai'].contextWindow).toBe('123456');
  });

  it('falls back to preset defaults when provider config is missing', () => {
    const snapshot = buildApiConfigSnapshot(undefined, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.profiles.openrouter.baseUrl).toBe(FALLBACK_PROVIDER_PRESETS.openrouter.baseUrl);
    expect(snapshot.profiles.openai.model).toBe(FALLBACK_PROVIDER_PRESETS.openai.models[0]?.id);
  });
});

