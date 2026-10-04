/**
 * `voice.monitor*` 五个通道的编排。
 *
 * 只测「事件按约定推出去」这一件事 —— VAD 本身在 `vad-engine.test.ts` 里测过了。
 * 这里用一个受控的假包装器把 ipc 层与真模型隔开，与 `local-engine.test.ts`
 * 的假 addon 是同一个思路。
 *
 * 关键约定：**vad 事件不带 sessionId**。它必须在朗读期（没有 ASR 会话时）
 * 也能送达，否则渲染层无从判断用户有没有开口打断。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceEvent } from "../../shared/ipc-types";

const mocks = vi.hoisted(() => {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  /** VAD 实例共享的 isDetected 脚本。 */
  const detected: boolean[] = [];
  const resets = { count: 0 };
  return { handlers, detected, resets };
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

vi.mock("../../main/speech/installer", () => ({
  MODEL_ID: "m",
  RUNTIME_VERSION: "1.13.8",
  voiceRoot: (p: string) => `${p}/voice`,
  readManifest: () => ({ runtimeVersion: "1.13.8", model: "m" }),
  installModel: vi.fn(),
  installRuntime: vi.fn(),
  removeVoiceModel: vi.fn(),
}));

vi.mock("../../main/speech/runtime-spec", () => ({
  readRuntimeSpec: () => ({
    modelUrl: "u",
    modelSha256: "s",
    nodeSha256: "n",
    runtimeSha256: {},
    ttsModelUrl: "u",
    ttsModelSha256: "s",
    ttsEnglishModelUrl: "u",
    ttsEnglishModelSha256: "s",
  }),
  readBundledModelPath: () => "/silero_vad.onnx",
  runtimeKey: () => "darwin-arm64",
}));

vi.mock("../../main/voice/local-engine", () => ({
  LocalTranscriptionEngine: class {},
  loadSherpaAddon: () => ({}),
}));

/**
 * `Vad` 必须是**可构造**的 —— 生产代码写的是 `new wrapper.Vad(...)`，
 * 箭头函数不可构造。
 */
vi.mock("../../main/voice/sherpa-wrapper", () => ({
  loadSherpaWrapper: () => ({
    Vad: class {
      private step = 0;
      acceptWaveform(): void {}
      isDetected(): boolean {
        return mocks.detected[this.step++] ?? false;
      }
      isEmpty(): boolean {
        return true;
      }
      pop(): void {}
      reset(): void {
        mocks.resets.count += 1;
        this.step = 0;
      }
    },
  }),
}));

const { registerVoiceIpc } = await import("../../main/voice/ipc");

const call = (channel: string, ...args: unknown[]) => {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, ...args);
};

/** 一个 512 采样的窗口，正好让引擎喂一次模型。 */
const oneWindow = () => new Int16Array(512).buffer;

describe("voice monitor ipc", () => {
  const events: VoiceEvent[] = [];

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.detected.length = 0;
    mocks.resets.count = 0;
    events.length = 0;
    registerVoiceIpc({
      sendEvent: (e) => events.push(e),
      userDataPath: "/tmp/u",
    });
  });

  it("五个通道都注册了", () => {
    for (const channel of [
      "voice.monitorStart",
      "voice.monitorAudio",
      "voice.monitorProfile",
      "voice.monitorReset",
      "voice.monitorStop",
    ]) {
      expect(mocks.handlers.has(channel), channel).toBe(true);
    }
  });

  it("未启动时喂音频不报错也不出事件", () => {
    expect(() => call("voice.monitorAudio", oneWindow())).not.toThrow();
    expect(events).toEqual([]);
  });

  it("start 之后喂满一个窗口就出 speech-start，且不带 sessionId", async () => {
    mocks.detected.push(true);
    await call("voice.monitorStart");
    await call("voice.monitorAudio", oneWindow());
    expect(events).toEqual([{ type: "vad", edge: "speech-start" }]);
  });

  it("stop 之后不再出事件，且清了引擎", async () => {
    mocks.detected.push(false, true);
    await call("voice.monitorStart");
    await call("voice.monitorStop");
    await call("voice.monitorAudio", oneWindow());
    expect(events).toEqual([]);
  });

  it("monitorStop 先复位，让复用的实例不带着旧状态", async () => {
    mocks.detected.push(false);
    await call("voice.monitorStart");
    const before = mocks.resets.count;
    await call("voice.monitorStop");
    expect(mocks.resets.count).toBe(before + 1);
  });

  it("monitorProfile 接受两个已知值，忽略其它", async () => {
    await call("voice.monitorStart");
    // 未知值既不抛也不该动状态
    expect(() => call("voice.monitorProfile", "bogus")).not.toThrow();
    expect(() => call("voice.monitorProfile", "barge-in")).not.toThrow();
    expect(() => call("voice.monitorProfile", "interactive")).not.toThrow();
    expect(events).toEqual([]);
  });

  it("monitorReset 在还在说话时报一声 speech-end，让渲染层不失同步", async () => {
    mocks.detected.push(true);
    await call("voice.monitorStart");
    await call("voice.monitorAudio", oneWindow());
    expect(events).toEqual([{ type: "vad", edge: "speech-start" }]);

    events.length = 0;
    await call("voice.monitorReset");
    // reset 在"还在说话"时会报一声 speech-end，让渲染层不失同步
    expect(events).toEqual([{ type: "vad", edge: "speech-end" }]);
  });

  it("非 ArrayBuffer 的音频被忽略", async () => {
    mocks.detected.push(true);
    await call("voice.monitorStart");
    expect(() => call("voice.monitorAudio", "not a buffer")).not.toThrow();
    expect(() => call("voice.monitorAudio", null)).not.toThrow();
    expect(events).toEqual([]);
  });

  it("dispose 之后喂音频不再出事件", async () => {
    mocks.detected.push(true);
    const handle = registerVoiceIpc({
      sendEvent: (e) => events.push(e),
      userDataPath: "/tmp/u",
    });
    await call("voice.monitorStart");
    handle.dispose();
    await call("voice.monitorAudio", oneWindow());
    expect(events).toEqual([]);
  });
});
