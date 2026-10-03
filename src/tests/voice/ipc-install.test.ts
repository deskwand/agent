/**
 * `voice.install` 的编排。
 *
 * 为什么需要：安装器的两个函数（`installRuntime` / `installModel`）有真产物 e2e 覆盖，
 * 但**把它们编排起来的那段逻辑**没有 —— 而它就藏在 handler 里：
 *
 *   - 按清单判断该装哪一段（幂等：已装的重跑不该再下 123MB）
 *   - 进度按**体积**分成两段（运行时 8.7~10.8MB / 模型 128MB），不是五五分
 *   - 失败时不落「已安装」
 *
 * 真下载不在这里做（那是 manual e2e 的事），这里只验编排。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceEvent, VoiceInstallState } from "../../shared/ipc-types";

const mocks = vi.hoisted(() => {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  return {
    handlers,
    readManifest: vi.fn(),
    installRuntime: vi.fn(),
    installModel: vi.fn(),
    readRuntimeSpec: vi.fn(),
  };
});

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
    getMediaAccessStatus: () => "granted",
    askForMediaAccess: async () => true,
  },
}));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: () => ({ voiceEngine: { enabled: true, shortcut: "AltRight" } }),
  },
}));

vi.mock("../../main/speech/installer", async () => {
  const actual = await vi.importActual<typeof InstallerModule>(
    "../../main/speech/installer",
  );
  return {
    ...actual,
    readManifest: mocks.readManifest,
    installRuntime: mocks.installRuntime,
    installModel: mocks.installModel,
    removeVoiceModel: vi.fn(),
  };
});

vi.mock("../../main/speech/runtime-spec", () => ({
  readRuntimeSpec: mocks.readRuntimeSpec,
  runtimeKey: () => "darwin-arm64",
}));

import type * as InstallerModule from "../../main/speech/installer";
import { MODEL_ID, RUNTIME_VERSION } from "../../main/speech/installer";
import { registerVoiceIpc } from "../../main/voice/ipc";

const events: VoiceEvent[] = [];

function installStates(): VoiceInstallState[] {
  return events
    .filter(
      (e): e is Extract<VoiceEvent, { type: "install" }> =>
        e.type === "install",
    )
    .map((e) => e.state);
}

function run() {
  mocks.handlers.clear();
  events.length = 0;
  registerVoiceIpc({
    userDataPath: "/tmp/voice-install-orchestration",
    sendEvent: (e: VoiceEvent) => events.push(e),
  } as never);
  return mocks.handlers.get("voice.install")!(null) as Promise<{
    ok: boolean;
    error?: string;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readRuntimeSpec.mockReturnValue({
    modelUrl: "https://example.test/model.tar.gz",
    modelSha256: "a".repeat(64),
    nodeSha256: "b".repeat(64),
    runtimeSha256: { "darwin-arm64": "c".repeat(64) },
  });
  // 默认什么都没装
  mocks.readManifest.mockReturnValue(null);
  mocks.installRuntime.mockResolvedValue(undefined);
  mocks.installModel.mockResolvedValue(undefined);
});

describe("voice.install", () => {
  it("两段都没装时依次装，最后落 ready", async () => {
    const result = await run();

    expect(mocks.installRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.installModel).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(installStates().at(-1)).toEqual({
      phase: "ready",
      percent: 100,
      installed: true,
    });
  });

  it("运行时已是当前版本时跳过它（不能白下 10MB）", async () => {
    mocks.readManifest.mockReturnValue({
      runtimeVersion: RUNTIME_VERSION,
      model: "",
      installedAt: "x",
    });

    await run();

    expect(mocks.installRuntime).not.toHaveBeenCalled();
    expect(mocks.installModel).toHaveBeenCalledTimes(1);
  });

  it("模型已装时跳过它（不能白下 123MB）", async () => {
    mocks.readManifest.mockReturnValue({
      runtimeVersion: RUNTIME_VERSION,
      model: MODEL_ID,
      installedAt: "x",
    });

    await run();

    expect(mocks.installRuntime).not.toHaveBeenCalled();
    expect(mocks.installModel).not.toHaveBeenCalled();
  });

  it("进度按体积分两段：运行时占前 7%，模型接着到 100%", async () => {
    // 运行时 8.7~10.8MB、模型 128MB。五五分会让人以为 1 秒就下完了，
    // 然后卡着不动 —— 首次启用是最敏感的一屏。
    mocks.installRuntime.mockImplementation(
      async (opts: { onProgress: (p: number) => void }) => {
        opts.onProgress(0);
        opts.onProgress(100);
      },
    );
    mocks.installModel.mockImplementation(
      async (opts: { onProgress: (p: number) => void }) => {
        opts.onProgress(0);
        opts.onProgress(100);
      },
    );

    await run();

    const percents = installStates().map((s) => s.percent);
    // 运行时那一段的天花板就是 RUNTIME_SHARE。五五分会在这一段里出现 50。
    const runtimeEnd = percents.indexOf(7);
    expect(runtimeEnd).toBeGreaterThan(0);
    expect(percents.slice(0, runtimeEnd + 1).every((p) => p <= 7)).toBe(true);
    expect(percents.at(-1)).toBe(100);
    // 单调不回退
    expect(percents.every((p, i) => i === 0 || p >= percents[i - 1])).toBe(
      true,
    );
  });

  it("安装失败时报错，且不落「已安装」", async () => {
    mocks.installModel.mockRejectedValue(new Error("sha256 mismatch"));

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("sha256 mismatch");
    const states = installStates();
    expect(states.at(-1)?.phase).toBe("error");
    expect(states.some((s) => s.installed)).toBe(false);
  });

  it("运行时装好了但模型失败时，不把整体标成已装", async () => {
    // 半装状态必须对 isInstalled() 为假，否则下次启动会拿着半套文件去建引擎。
    mocks.installRuntime.mockImplementation(
      async (opts: { onProgress: (p: number) => void }) => {
        opts.onProgress(0);
        opts.onProgress(100); // 运行时跑完 → 7%
      },
    );
    mocks.installModel.mockRejectedValue(new Error("boom"));

    await run();

    expect(mocks.installRuntime).toHaveBeenCalledTimes(1);
    expect(installStates().at(-1)).toEqual({
      phase: "error",
      percent: 7,
      installed: false,
      error: "boom",
    });
  });
});

/**
 * `voice.removeInstall` 的失败形态。
 *
 * Windows 上正被原生 addon 内存映射着的模型文件删不掉（EBUSY/EPERM）。原来的
 * handler 没有 try/catch：异常直接让渲染侧的 `await` reject，设置页停在「已安装」，
 * 而目录可能只删了一半 —— 用户既用不了也删不掉，还多一条未处理的 rejection。
 */
function runRemove() {
  mocks.handlers.clear();
  events.length = 0;
  registerVoiceIpc({
    userDataPath: "/tmp/voice-install-orchestration",
    sendEvent: (e: VoiceEvent) => events.push(e),
  } as never);
  return mocks.handlers.get("voice.removeInstall")!(null) as Promise<{
    ok: boolean;
    error?: string;
  }>;
}

describe("voice.removeInstall", () => {
  it("删不掉时返回失败，并且不谎称已删", async () => {
    const { removeVoiceModel } = await import("../../main/speech/installer");
    vi.mocked(removeVoiceModel).mockImplementation(() => {
      throw new Error("EBUSY: resource busy or locked");
    });
    // 删失败时清单还在 → 它确实还是「已安装」
    mocks.readManifest.mockReturnValue({
      runtimeVersion: RUNTIME_VERSION,
      model: MODEL_ID,
    });

    const result = await runRemove();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("EBUSY");
    // 最后推给渲染层的状态必须是「仍然装着」，不能是 idle
    expect(installStates().at(-1)?.installed).toBe(true);
  });

  it("删成功时落 idle", async () => {
    const { removeVoiceModel } = await import("../../main/speech/installer");
    vi.mocked(removeVoiceModel).mockImplementation(() => {});
    mocks.readManifest.mockReturnValue(null);

    const result = await runRemove();

    expect(result.ok).toBe(true);
    expect(installStates().at(-1)).toMatchObject({
      phase: "idle",
      installed: false,
    });
  });
});
