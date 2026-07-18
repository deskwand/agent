import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userDataPath: '',
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public path: string;
    public store: T;

    constructor(options: { name?: string; defaults?: T }) {
      const name = options.name || 'config';
      this.path = path.join(state.userDataPath, `${name}.json`);

      if (fs.existsSync(this.path)) {
        const raw = fs.readFileSync(this.path, 'utf8');
        this.store = {
          ...(options.defaults || ({} as T)),
          ...(JSON.parse(raw) as T),
        };
        return;
      }

      this.store = { ...(options.defaults || ({} as T)) };
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store = { ...this.store, [key]: value };
      } else {
        this.store = { ...this.store, ...(key as T) };
      }
      fs.writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    }

    clear(): void {
      this.store = {} as T;
      fs.writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    }
  }

  return { default: MockStore };
});

describe('ConfigStore plain JSON behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskwand-config-'));
    state.userDataPath = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('reads a valid plain JSON config file', async () => {
    const storePath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          activeProviderKey: 'openai',
          providers: {
            openai: {
              provider: 'openai',
              customProtocol: 'openai',
              apiKey: 'sk-openai',
              baseUrl: 'https://api.openai.com/v1',
              defaultModel: 'gpt-5.4',
              models: [],
              updatedAt: '2026-06-19T00:00:00.000Z',
            },
          },
          deskWandCodePath: '',
          defaultWorkdir: '',
          enableDevLogs: false,
          theme: 'light',
          themePreset: 'graphite',
          sandboxEnabled: false,
          memoryEnabled: true,
          memoryRuntime: {
            llm: {
              inheritFromActive: true,
              apiKey: '',
              baseUrl: '',
              model: '',
              timeoutMs: 180000,
            },
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
            storageRoot: '',
            evalEnabled: false,
            evalWorkspaces: [],
            evalMaxRounds: 12,
            evalArtifactsRoot: '',
            promptIterationRounds: 2,
          },
          enableThinking: false,
          thinkingLevel: 'medium',
          autoSkillLearning: true,
          isConfigured: true,
        },
        null,
        2,
      ),
    );

    const { ConfigStore } = await import('../src/main/config/config-store');
    const store = new ConfigStore();

    expect(store.get('activeProviderKey')).toBe('openai');
    expect(store.getAll().providers.openai?.apiKey).toBe('sk-openai');
  });

  it('throws on invalid JSON without creating unreadable recovery backups', async () => {
    const storePath = path.join(tempDir, 'config.json');
    const invalidContent = '{ invalid json';
    fs.writeFileSync(storePath, invalidContent);

    const load = async () => {
      const { ConfigStore } = await import('../src/main/config/config-store');
      return new ConfigStore();
    };

    await expect(load()).rejects.toThrow();
    expect(fs.readFileSync(storePath, 'utf8')).toBe(invalidContent);

    const backups = fs
      .readdirSync(tempDir)
      .filter((file) => file.startsWith('config.json.unreadable-recovery-'));
    expect(backups).toHaveLength(0);
  });

  it('creates defaults when config.json is missing', async () => {
    const { ConfigStore } = await import('../src/main/config/config-store');
    const store = new ConfigStore();

    expect(store.get('activeProviderKey')).toBe('openrouter');
    expect(fs.existsSync(path.join(tempDir, 'config.json'))).toBe(true);
  });

  it('creates normalized Web Access defaults', async () => {
    const { ConfigStore } = await import('../src/main/config/config-store');
    const store = new ConfigStore();

    expect(store.get('webAccess')).toEqual({
      defaultProvider: 'auto',
      openai: { source: 'inherit', profileKey: '', apiKey: '', baseUrl: '' },
      gemini: { source: 'inherit', profileKey: '', apiKey: '', baseUrl: '' },
      exaApiKey: '',
      braveApiKey: '',
      parallelApiKey: '',
      tavilyApiKey: '',
      perplexityApiKey: '',
    });
  });

  it('persists normalized Web Access settings', async () => {
    const { ConfigStore } = await import('../src/main/config/config-store');
    const store = new ConfigStore();

    store.update({
      webAccess: {
        ...store.get('webAccess'),
        defaultProvider: 'brave',
        braveApiKey: 'brave-key',
        openai: {
          source: 'dedicated',
          profileKey: '',
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
        },
      },
    });

    expect(store.get('webAccess').defaultProvider).toBe('brave');
    expect(store.get('webAccess').braveApiKey).toBe('brave-key');
    expect(store.get('webAccess').openai.source).toBe('dedicated');
  });
});
