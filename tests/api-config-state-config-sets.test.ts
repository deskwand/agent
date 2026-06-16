import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/renderer/types';
import {
  FALLBACK_PROVIDER_PRESETS,
  buildApiConfigBootstrap,
  buildApiConfigDraftSignature,
  buildApiConfigSnapshot,
} from '../src/renderer/hooks/useApiConfigState';

describe('api provider bootstrap helpers', () => {
  it('builds bootstrap state from provider configs', () => {
    const config = {
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      activeProfileKey: 'openai',
      activeProviderKey: 'openai',
      profiles: {},
      providers: {
        openai: {
          provider: 'openai',
          customProtocol: 'openai',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5.4-mini',
          models: [
            { id: 'gpt-5.4', label: 'gpt-5.4', source: 'preset' },
            { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', source: 'preset' },
          ],
          updatedAt: '2026-05-24T00:00:00.000Z',
        },
      },
      omagtCodePath: '',
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

    const bootstrap = buildApiConfigBootstrap(config, FALLBACK_PROVIDER_PRESETS);

    expect(bootstrap.activeProviderKey).toBe('openai');
    expect(bootstrap.providers.openai?.models).toHaveLength(2);
    expect(bootstrap.snapshot.profiles.openai.model).toBe('gpt-5.4-mini');
  });

  it('builds a stable draft signature for unchanged state', () => {
    const snapshot = buildApiConfigSnapshot(undefined, FALLBACK_PROVIDER_PRESETS);
    const sigA = buildApiConfigDraftSignature(
      snapshot.activeProfileKey,
      snapshot.profiles,
      snapshot.enableThinking
    );
    const sigB = buildApiConfigDraftSignature(
      snapshot.activeProfileKey,
      snapshot.profiles,
      snapshot.enableThinking
    );

    expect(sigA).toBe(sigB);
  });
});

