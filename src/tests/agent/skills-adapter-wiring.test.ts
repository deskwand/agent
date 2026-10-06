import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsAdapter } from "../../main/skills/skills-adapter";
import type { DatabaseInstance } from "../../main/db/database";

/** 每次 SessionManager 造 runner 时记录：适配器走构造参数（重建时的唯一途径）。 */
const runners: Array<{ skillsAdapter?: SkillsAdapter }> = [];
/** 对当前 runner 的 setter 调用记录。 */
const setterCalls: Array<SkillsAdapter | undefined> = [];

vi.mock("../../main/utils/logger", () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../main/agent/agent-runner", () => ({
  AgentRunner: class {
    onSessionFileCreated?: (sessionId: string, path: string) => void;
    cancel = vi.fn();
    clearSdkSession = vi.fn();
    clearAllSdkSessions = vi.fn();
    getSessionEntries = vi.fn(() => null);
    forkSessionFile = vi.fn(async () => null);
    compact = vi.fn(async () => "skipped" as const);
    abortCompaction = vi.fn();
    setSkillsAdapter = (adapter?: SkillsAdapter): void => {
      setterCalls.push(adapter);
    };

    constructor(
      _options: unknown,
      _pathResolver: unknown,
      skillsAdapter?: SkillsAdapter,
    ) {
      runners.push({ skillsAdapter });
    }
  },
}));

import { SessionManager } from "../../main/session/session-manager";

function createDbMock(): DatabaseInstance {
  const statement = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
  return {
    raw: {} as never,
    sessions: {
      update: vi.fn(),
      get: vi.fn(),
    } as never,
    messages: {} as never,
    traceSteps: {} as never,
    scheduledTasks: {} as never,
    prepare: vi.fn(() => statement as never),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  } as unknown as DatabaseInstance;
}

const adapter: SkillsAdapter = {
  getSkillPaths: async () => ["/skills/officecli"],
};

describe("SessionManager 把技能适配器交给 AgentRunner", () => {
  beforeEach(() => {
    runners.length = 0;
    setterCalls.length = 0;
  });

  it("注入时转发给当前 runner", () => {
    const manager = new SessionManager(createDbMock(), vi.fn());
    manager.setSkillsAdapter(adapter);
    expect(setterCalls.at(-1)).toBe(adapter);
  });

  it("活过 setBrowserViewManager 的 runner 重建", () => {
    // 真实启动顺序：main 先 setSkillsAdapter，随后注入 BrowserViewManager，
    // 后者会重建 AgentRunner。丢适配器 ⇒ 回落到 legacySkillPaths()，
    // 技能开关对模型失效、内置技能又全量进提示（本次修复的正是这个）。
    const manager = new SessionManager(createDbMock(), vi.fn());
    manager.setSkillsAdapter(adapter);
    const before = runners.length;
    manager.setBrowserViewManager({} as never);
    expect(runners.length).toBeGreaterThan(before);
    expect(runners.at(-1)?.skillsAdapter).toBe(adapter);
  });
});
