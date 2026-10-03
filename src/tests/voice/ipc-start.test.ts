/**
 * `voice.start` 的准入闸门。
 *
 * 为什么之前没有：整个 `voice.*` IPC 层零测试，而 `voice.start` 是这个功能的入口 ——
 * 它挡在四个门后面（引擎开关 / 是否已装 / 麦克风权限 / 引擎构造），任何一道判反了，
 * 用户看到的就是「点了没反应」或「该弹权限框却没弹」。
 *
 * 手法沿用 `src/tests/capabilities/ipc.test.ts`：真 `IpcMain` 在单测里拿不到，
 * 所以用一个抓 handler 的假 ipcMain。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = "/tmp/voice-ipc-start";

const mocks = vi.hoisted(() => {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  return {
    handlers,
    askForMediaAccess: vi.fn(),
    getMediaAccessStatus: vi.fn(),
    getAll: vi.fn(),
  };
});

// 注意这里比 capabilities 那边麻烦：`capabilities/index.ts` 把 ipcMain 当参数注入
// （就是为了好测），而 `voice/ipc.ts` 直接从 electron import 它。所以必须连 ipcMain
// 一起 mock，在模块层把 handler 截下来。
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, ...args: unknown[]) => unknown,
    ) => {
      mocks.handlers.set(channel, fn);
    },
  },
  systemPreferences: {
    askForMediaAccess: mocks.askForMediaAccess,
    getMediaAccessStatus: mocks.getMediaAccessStatus,
  },
}));

vi.mock("../../main/config/config-store", () => ({
  configStore: { getAll: mocks.getAll },
}));

// 引擎构造会去加载原生 addon —— 单测里不该碰它，这里只记「被构造过」。
const engineCtor = vi.hoisted(() => vi.fn());
vi.mock("../../main/voice/local-engine", () => ({
  loadSherpaAddon: vi.fn(() => ({})),
  LocalTranscriptionEngine: class {
    constructor(...args: unknown[]) {
      engineCtor(...args);
    }
    createStream() {
      return {
        push: () => ({ partial: "" }),
        finish: async () => ({ text: "" }),
        abort: () => {},
      };
    }
  },
}));

import { registerVoiceIpc } from "../../main/voice/ipc";

function register() {
  mocks.handlers.clear();
  registerVoiceIpc({ userDataPath: ROOT, sendEvent: () => {} } as never);
  return mocks.handlers;
}

/** 写一份「运行时与模型都已装」的清单，让 isInstalled() 为真。 */
function markInstalled(): void {
  const dir = join(ROOT, "voice");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "install.json"),
    JSON.stringify({
      runtimeVersion: "1.13.8",
      model: "x-asr-480ms-zh-en-punct-int8",
      installedAt: "2026-10-04T00:00:00.000Z",
    }),
  );
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  vi.clearAllMocks();
  mocks.getAll.mockReturnValue({
    voiceEngine: { enabled: true, shortcut: "AltRight" },
  });
  mocks.getMediaAccessStatus.mockReturnValue("granted");
  mocks.askForMediaAccess.mockResolvedValue(true);
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("voice.start 的闸门", () => {
  it("引擎没开时拒绝，且不碰麦克风", async () => {
    mocks.getAll.mockReturnValue({
      voiceEngine: { enabled: false, shortcut: "AltRight" },
    });
    const handlers = register();

    expect(await handlers.get("voice.start")!(null)).toEqual({
      ok: false,
      code: "VOICE_NOT_CONFIGURED",
    });
    expect(mocks.getMediaAccessStatus).not.toHaveBeenCalled();
  });

  it("没安装时拒绝，且不碰麦克风", async () => {
    const handlers = register();

    expect(await handlers.get("voice.start")!(null)).toEqual({
      ok: false,
      code: "VOICE_NOT_INSTALLED",
    });
    expect(mocks.getMediaAccessStatus).not.toHaveBeenCalled();
  });

  it("麦克风被拒时拒绝，且不构造引擎", async () => {
    // 这是最容易判反的一道：拿不到权限就绝不能往下走，
    // 否则会在没有授权的情况下建起一个永远收不到音频的会话。
    markInstalled();
    mocks.getMediaAccessStatus.mockReturnValue("denied");
    mocks.askForMediaAccess.mockResolvedValue(false);
    const handlers = register();

    expect(await handlers.get("voice.start")!(null)).toEqual({
      ok: false,
      code: "VOICE_MIC_DENIED",
    });
    expect(engineCtor).not.toHaveBeenCalled();
  });

  it("权限已授予时不再弹窗，直接放行", async () => {
    markInstalled();
    mocks.getMediaAccessStatus.mockReturnValue("granted");
    const handlers = register();

    const result = (await handlers.get("voice.start")!(null)) as {
      ok: boolean;
      sessionId?: string;
    };

    expect(result.ok).toBe(true);
    expect(typeof result.sessionId).toBe("string");
    expect(mocks.askForMediaAccess).not.toHaveBeenCalled();
    expect(engineCtor).toHaveBeenCalledTimes(1);
  });

  it("权限未定时弹窗，用户同意则放行", async () => {
    markInstalled();
    mocks.getMediaAccessStatus.mockReturnValue("not-determined");
    mocks.askForMediaAccess.mockResolvedValue(true);
    const handlers = register();

    const result = (await handlers.get("voice.start")!(null)) as {
      ok: boolean;
    };

    expect(mocks.askForMediaAccess).toHaveBeenCalledWith("microphone");
    expect(result.ok).toBe(true);
  });

  it("非 macOS 平台直接放行（没有这个 API）", async () => {
    markInstalled();
    mocks.getMediaAccessStatus.mockReturnValue("unknown");
    mocks.askForMediaAccess.mockResolvedValue(false);
    const handlers = register();

    // 用 process.platform 的真值跑：本机是 darwin 时这条断言的是 darwin 分支。
    // 之所以留着，是为了让「非 darwin 走捷径」这行在评审时看得见。
    const result = (await handlers.get("voice.start")!(null)) as {
      ok: boolean;
    };
    if (process.platform === "darwin") {
      expect(result.ok).toBe(false);
    } else {
      expect(result.ok).toBe(true);
    }
  });
});
