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
import type { AppConfig } from '../src/main/config/config-store';
import type { Session } from '../src/renderer/types';
import type { DatabaseInstance } from '../src/main/db/database';

const mockedGenerateTitleWithAgentSdk = vi.mocked(generateTitleWithAgentSdk);

describe('SessionManager unified title generation', () => {
  const previous = {
    disableDeskWandUnified: process.env.COWORK_DISABLE_DeskWand_UNIFIED,
    provider: configStore.get('provider'),
    customProtocol: configStore.get('customProtocol'),
    apiKey: configStore.get('apiKey'),
    baseUrl: configStore.get('baseUrl'),
    model: configStore.get('model'),
    activeProviderKey: configStore.get('activeProviderKey'),
  };

  beforeEach(() => {
    delete process.env.COWORK_DISABLE_DeskWand_UNIFIED;
    configStore.set('provider', 'openai');
    configStore.set('customProtocol', 'openai');
    configStore.set('apiKey', 'sk-test');
    configStore.set('model', 'gpt-5.4');
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
    configStore.set('activeProviderKey', previous.activeProviderKey);
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
        model: 'gpt-5.4',
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
describe('SessionManager title model candidates', () => {
  const session = {
    id: 'session-1',
    title: '帮我做个PPT',
    providerProfileKey: 'deepseek',
    model: 'deepseek-chat',
  } as unknown as Session;

  // 私有方法只能通过 prototype 取，沿用本文件既有写法（cast 成接口，不用 any）
  const proto = SessionManager.prototype as unknown as {
    resolveTitleModelCandidates(
      session: Session,
    ): Promise<Array<{ label: string; config: AppConfig }>>;
  };

  beforeEach(() => {
    // 轻量（激活）通道：openai
    configStore.set('provider', 'openai');
    configStore.set('apiKey', 'sk-test');
    configStore.set('model', 'gpt-5.4');
    configStore.set('baseUrl', '');
    // 会话自己的通道：deepseek（真实的 profile key，才能被 configStore 正常归一化）
    configStore.set('provider', 'deepseek');
    configStore.set('apiKey', 'sk-session');
    configStore.set('model', 'deepseek-chat');
    configStore.set('baseUrl', '');
    // 把激活通道指回 openai，于是 utility 候选 = openai 通道
    configStore.set('activeProviderKey', 'openai');
  });

  it('lists the utility channel first and the session channel as a fallback', async () => {
    const candidates = await proto.resolveTitleModelCandidates.call({}, session);

    expect(candidates.map((candidate) => candidate.label)).toEqual([
      'utility',
      'session',
    ]);
    // 候选 1：全局激活通道
    expect(candidates[0].config).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
    });
    // 候选 2：会话自己的 profile 与 model
    expect(candidates[1].config).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-session',
    });
  });

  it('dedupes when the utility channel and the session channel are the same', async () => {
    const sameChannelSession = {
      ...session,
      providerProfileKey: 'openai',
      model: 'gpt-5.4',
    } as unknown as Session;

    const candidates = await proto.resolveTitleModelCandidates.call(
      {},
      sameChannelSession,
    );

    expect(candidates.map((candidate) => candidate.label)).toEqual(['utility']);
  });

  it('degrades to the utility channel alone when the session resolver throws', async () => {
    // 两个 profile 都删掉 → modelResolutionService 无可用 provider 而抛错
    configStore.deleteProvider({ profileKey: 'openai' });
    configStore.deleteProvider({ profileKey: 'deepseek' });

    const candidates = await proto.resolveTitleModelCandidates.call({}, session);

    expect(candidates.map((candidate) => candidate.label)).toEqual(['utility']);
  });
});

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
describe('SessionManager title generation after a failed first run', () => {
  // 每个用例一个全新的 session 对象：标题生成成功时会写回 session.title，
  // 共享同一个对象会让下一个用例的门禁判成"标题已被改过"。
  function makeSession() {
    return {
      id: 'session-1',
      title: '帮我做个PPT',
      cwd: null, // 跳过 sandbox 初始化
      providerProfileKey: 'deepseek',
      model: 'deepseek-chat',
    } as unknown as Session;
  }

  beforeEach(() => {
    // 轻量（激活）通道：openai
    configStore.set('provider', 'openai');
    configStore.set('apiKey', 'sk-test');
    configStore.set('model', 'gpt-5.4');
    configStore.set('baseUrl', '');
    // 会话自己的通道：deepseek
    configStore.set('provider', 'deepseek');
    configStore.set('apiKey', 'sk-session');
    configStore.set('model', 'deepseek-chat');
    configStore.set('baseUrl', '');
    configStore.set('activeProviderKey', 'openai');
    // 用 mockReset + 重设实现，而非 mockClear：避免上一个用例残留的
    // mockResolvedValueOnce 队列影响下一个用例
    mockedGenerateTitleWithAgentSdk.mockReset();
    mockedGenerateTitleWithAgentSdk.mockImplementation(
      async () => 'Unified Title',
    );
  });

  const processPrompt = SessionManager.prototype[
    'processPrompt'
  ] as unknown as (
    this: unknown,
    session: unknown,
    prompt: string,
  ) => Promise<void>;

  function makeManager(session: Session) {
    const update = vi.fn();
    const db = makeDb({
      sessions: {
        ...makeDb().sessions,
        get: vi.fn(() => ({ id: 'session-1', title: session.title })),
        update,
      } as unknown as DatabaseInstance['sessions'],
    });
    const manager = new SessionManager(db, vi.fn());
    const runner = (
      manager as unknown as { agentRunner: { run: ReturnType<typeof vi.fn> } }
    ).agentRunner;
    return { manager, update, runner };
  }

  it('still updates the session title when the first agent run throws', async () => {
    const session = makeSession();
    const { manager, update, runner } = makeManager(session);
    runner.run.mockRejectedValue(new Error('upstream exploded'));

    await processPrompt.call(manager, session, '帮我做个PPT');

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith('session-1', {
        title: 'Unified Title',
      });
    });
  });

  it('falls back to the session model when the utility candidate returns nothing', async () => {
    const session = makeSession();
    mockedGenerateTitleWithAgentSdk
      .mockResolvedValueOnce('(no content)') // 归一化后为 null，链应继续
      .mockResolvedValueOnce('会话标题');
    const { manager, update } = makeManager(session);

    await processPrompt.call(manager, session, '帮我做个PPT');

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith('session-1', { title: '会话标题' });
    });
    expect(mockedGenerateTitleWithAgentSdk).toHaveBeenCalledTimes(2);
    // 第二发必须真的换到了会话自己的通道，而不是同一通道重试两次
    expect(mockedGenerateTitleWithAgentSdk).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ provider: 'deepseek', model: 'deepseek-chat' }),
    );
  });

  it('does not generate a title when the prompt is intercepted as a /goal command', async () => {
    const session = makeSession();
    const update = vi.fn();
    const db = makeDb({
      sessions: {
        ...makeDb().sessions,
        get: vi.fn(() => ({ id: 'session-1', title: session.title })),
        update,
      } as unknown as DatabaseInstance['sessions'],
    });
    // /goal 会走扩展命令分支并提前 return（用户消息未保存）
    const extensionManager = {
      getExtension: () => undefined,
      handleCommand: async () => ({ handled: true, message: 'goal started' }),
    };
    const manager = new SessionManager(
      db,
      vi.fn(),
      extensionManager as unknown as ConstructorParameters<
        typeof SessionManager
      >[2],
    );

    await processPrompt.call(manager, session, '/goal 重构日志模块');

    expect(update).not.toHaveBeenCalled();
    expect(mockedGenerateTitleWithAgentSdk).not.toHaveBeenCalled();
  });
});
