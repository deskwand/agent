import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ readAloudEnabled: true }));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: () => ({ readAloud: { enabled: config.readAloudEnabled } }),
  },
}));
import { TTS_MODEL_ID, voiceRoot } from "../../main/speech/installer";
import { registerTtsIpc } from "../../main/tts/ipc";
import type { TtsService } from "../../main/tts/service";

/** 极简的 ipcMain 替身：只记 handler，由测试自己调用。 */
function fakeIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => handlers.delete(channel),
    invoke: (channel: string, ...args: unknown[]) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return fn({}, ...args);
    },
  };
}

function installedUserData(): string {
  const userData = mkdtempSync(join(tmpdir(), "tts-ipc-"));
  mkdirSync(join(voiceRoot(userData), "models", TTS_MODEL_ID), {
    recursive: true,
  });
  writeFileSync(
    join(voiceRoot(userData), "install.json"),
    JSON.stringify({
      runtimeVersion: "1.13.8",
      model: "x-asr-480ms-zh-en-punct-int8",
      ttsModel: TTS_MODEL_ID,
      installedAt: "x",
    }),
  );
  return userData;
}

function serviceStub(overrides: Partial<TtsService> = {}): TtsService {
  return {
    isInstalled: () => true,
    load: vi.fn(async () => {}),
    speak: vi.fn(async () => ({
      ok: true,
      samples: new Float32Array([0.1, 0.2]),
      sampleRate: 44100,
    })),
    ...overrides,
  } as TtsService;
}

describe("registerTtsIpc", () => {
  beforeEach(() => {
    config.readAloudEnabled = true;
  });

  it("reports the model as installed when the manifest says so", async () => {
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        service: serviceStub(),
      },
    });
    const state = (await ipc.invoke("tts.getInstallState")) as {
      installed: boolean;
    };
    expect(state.installed).toBe(true);
  });

  it("synthesizes through the injected service", async () => {
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        service: serviceStub(),
      },
    });
    const result = (await ipc.invoke("tts.speak", "你好")) as {
      ok: boolean;
      sampleRate: number;
    };
    expect(result.ok).toBe(true);
    expect(result.sampleRate).toBe(44100);
  });

  it("returns ok:false instead of throwing when synthesis fails", async () => {
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        service: serviceStub({
          speak: vi.fn(async () => ({
            ok: false as const,
            error: "model file missing",
          })),
        }),
      },
    });
    const result = (await ipc.invoke("tts.speak", "你好")) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing");
  });

  it("removes only the read-aloud model", async () => {
    const userData = installedUserData();
    mkdirSync(join(voiceRoot(userData), "runtime", "1.13.8"), {
      recursive: true,
    });
    const ipc = fakeIpcMain();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: userData,
        sendEvent: vi.fn(),
        service: serviceStub(),
      },
    });

    await ipc.invoke("tts.removeInstall");

    expect(existsSync(join(voiceRoot(userData), "models", TTS_MODEL_ID))).toBe(
      false,
    );
    // 运行时不受影响 —— 它被语音输入共享
    expect(existsSync(join(voiceRoot(userData), "runtime", "1.13.8"))).toBe(
      true,
    );
  });

  it("fails the install when the engine cannot load (install-time self check)", async () => {
    // 装完立刻自检：平台不兼容要让用户在下完 157MB 的那一刻就知道，
    // 而不是点朗读时才发现。
    const ipc = fakeIpcMain();
    const events: { phase: string; error?: string }[] = [];
    const userData = mkdtempSync(join(tmpdir(), "tts-selfcheck-"));
    const removeTtsModel = vi.fn();
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: userData,
        sendEvent: (event) => events.push(event.state),
        service: serviceStub({
          isInstalled: () => false,
          speak: vi.fn(async () => ({
            ok: false as const,
            error: "dlopen failed",
          })),
        }),
        installDeps: {
          readSpec: () => ({
            modelUrl: "u",
            modelSha256: "h",
            nodeSha256: "h",
            runtimeSha256: { "darwin-arm64": "h" },
            ttsModelUrl: "u",
            ttsModelSha256: "h",
          }),
          installRuntime: vi.fn(async () => {}),
          installTtsModel: vi.fn(async () => {}),
          removeTtsModel,
        },
      },
    });

    await ipc.invoke("tts.install");

    expect(events.at(-1)?.phase).toBe("error");
    expect(events.at(-1)?.error).toContain("dlopen");
    // 自检失败要把刚装的东西撤掉：留着清单会让重试被 isInstalled() 挡住，
    // 用户既用不了也修不了。
    expect(removeTtsModel).toHaveBeenCalledWith(userData);
  });

  it("refuses to speak when the capability is switched off", async () => {
    // 设置卡只管下载是不够的：关掉开关必须真的不干活（设计 §6.1 验收第 4 条）
    config.readAloudEnabled = false;
    const ipc = fakeIpcMain();
    const speak = vi.fn(async () => ({
      ok: true as const,
      samples: new Float32Array(1),
      sampleRate: 44100,
    }));
    registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        service: serviceStub({ speak }),
      },
    });

    const result = (await ipc.invoke("tts.speak", "你好")) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("disabled");
    expect(speak).not.toHaveBeenCalled();
  });

  it("disposes every channel", () => {
    const ipc = fakeIpcMain();
    const handle = registerTtsIpc({
      ipcMain: ipc as never,
      deps: {
        userDataPath: installedUserData(),
        sendEvent: vi.fn(),
        service: serviceStub(),
      },
    });
    handle.dispose();
    expect(() => ipc.invoke("tts.getInstallState")).toThrow("no handler");
  });
});
