import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MicError,
  startMicCapture,
  type MicCapture,
} from "../../renderer/utils/voice/mic-capture";

/**
 * 这一组测试的由来：真机上点麦克风报「找不到可用的麦克风」，而麦克风是好的。
 *
 * 根因是 worklet 用 `URL.createObjectURL` 生成的 `blob:` URL 加载，而 CSP 的
 * `script-src 'self' 'wasm-unsafe-eval'` 不含 `blob:` → Chromium 拒绝加载 →
 * `addModule` 抛 `AbortError`（不是 MicError）→ 被兜底成「找不到可用的麦克风」。
 *
 * 所以这里守两件事：**worklet 必须从同源真文件加载**，以及**采集失败要如实上报**。
 * 单测跑在 node 环境（无 DOM），下面按需 stub 全局。
 */

const addModule = vi.fn();
const close = vi.fn();
const trackStop = vi.fn();
let gainValue = -1;

class FakeAudioContext {
  sampleRate = 16000;
  destination = {};
  audioWorklet = { addModule };
  close = close;
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createGain = () => ({
    gain: {
      get value() {
        return gainValue;
      },
      set value(v: number) {
        gainValue = v;
      },
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
}

class FakeAudioWorkletNode {
  port = { onmessage: null as unknown, postMessage: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}

const getUserMedia = vi.fn();

function installGlobals(): void {
  vi.stubGlobal("document", { baseURI: "file:///app/dist/index.html" });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

function micStream() {
  return { getTracks: () => [{ stop: trackStop }] };
}

beforeEach(() => {
  addModule.mockReset().mockResolvedValue(undefined);
  close.mockReset();
  trackStop.mockReset();
  gainValue = -1;
  getUserMedia.mockReset().mockResolvedValue(micStream());
  installGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startMicCapture — worklet 加载方式（这条守着真机那个 bug）", () => {
  it("从同源真文件加载 worklet，不用 blob: URL", async () => {
    await startMicCapture(() => {});

    expect(addModule).toHaveBeenCalledTimes(1);
    const url = String(addModule.mock.calls[0][0]);

    // blob: 会被 CSP 的 script-src 'self' 拒绝；data: 同样不在白名单里。
    expect(url).not.toMatch(/^(blob|data):/);
    // 同源：与页面同目录，靠 document.baseURI 解析（dev 的 http 与 prod 的 file:// 都成立）
    expect(url).toBe("file:///app/dist/pcm-worklet.js");
  });

  it("worklet 文件真的存在于 public/（改名/挪位置这条会红）", () => {
    // public/ 是 vite 的 publicDir → 原样拷到 dist 根，**不会被内联成 data: URL**
    // （vite 会把小于 4KB 的资产内联，data: 又不在 script-src 里，那会换个方式再坏一次）
    const file = fileURLToPath(
      new URL("../../../public/pcm-worklet.js", import.meta.url),
    );
    expect(existsSync(file)).toBe(true);
  });
});

describe("startMicCapture — 权限分类", () => {
  it("NotAllowedError / SecurityError → VOICE_MIC_DENIED", async () => {
    for (const name of ["NotAllowedError", "SecurityError"]) {
      getUserMedia.mockRejectedValueOnce(new DOMException("x", name));
      await expect(startMicCapture(() => {})).rejects.toMatchObject({
        code: "VOICE_MIC_DENIED",
      });
    }
  });

  it("其他 getUserMedia 失败 → VOICE_MIC_UNAVAILABLE", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("no device", "NotFoundError"),
    );
    await expect(startMicCapture(() => {})).rejects.toMatchObject({
      code: "VOICE_MIC_UNAVAILABLE",
    });
  });
});

describe("startMicCapture — 权限通过之后失败", () => {
  it("worklet 加载失败 → VOICE_CAPTURE_FAILED，不是「找不到麦克风」", async () => {
    addModule.mockRejectedValueOnce(
      new DOMException("Unable to load a worklet's module.", "AbortError"),
    );
    const error = await startMicCapture(() => {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicError);
    // 麦克风明明拿到了，报「找不到可用的麦克风」就是撒谎
    expect((error as MicError).code).toBe("VOICE_CAPTURE_FAILED");
  });

  it("AudioContext 构造失败也归到 VOICE_CAPTURE_FAILED", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("boom");
        }
      },
    );
    await expect(startMicCapture(() => {})).rejects.toMatchObject({
      code: "VOICE_CAPTURE_FAILED",
    });
  });

  it("采集启动失败时把麦克风流关掉 —— 否则系统录音指示灯一直亮着", async () => {
    addModule.mockRejectedValueOnce(new Error("boom"));
    await startMicCapture(() => {}).catch(() => {});
    expect(trackStop).toHaveBeenCalled();
  });

  it("把真实错误打进日志 —— 兜底文案会盖住原因，日志是唯一的线索", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    addModule.mockRejectedValueOnce(new Error("real cause"));
    await startMicCapture(() => {}).catch(() => {});

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.flat();
    expect(
      logged.some(
        (arg) => arg instanceof Error && arg.message === "real cause",
      ),
    ).toBe(true);
    spy.mockRestore();
  });
});

describe("startMicCapture — 成功路径", () => {
  it("worklet 接在零增益节点之后（直连 destination 会回授）", async () => {
    const capture: MicCapture = await startMicCapture(() => {});
    expect(gainValue).toBe(0);
    capture.stop();
  });

  it("stop() 释放麦克风与 AudioContext", async () => {
    const capture = await startMicCapture(() => {});
    capture.stop();
    expect(trackStop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
