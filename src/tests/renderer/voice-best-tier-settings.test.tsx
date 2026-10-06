// @vitest-environment jsdom
/**
 * 设置 →「能力」→ 语音对话卡里的**第三档**（最佳音质）与三档共用的试听。
 *
 * 三条容易被改坏的契约：
 * 1. 切到「最佳音质」**不开始下载**（900MB 不能靠一个下拉静默触发）；
 * 2. 引擎装不上时**按钮不出现**，而且已经装好的前两档不受影响；
 * 3. 试听**一次只有一个在飞**，切档会停掉上一个。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TtsEvent,
  TtsInstallState,
  TtsInstallStates,
  TtsStreamEvent,
} from "../../shared/ipc-types";
import type { EngineInstallState } from "../../shared/engine-install";
import type { AppConfig } from "../../renderer/types";

const api = vi.hoisted(() => {
  const tts = {
    getInstallState: vi.fn(),
    onEvent: vi.fn(),
    install: vi.fn(),
    removeInstall: vi.fn(),
    getEngineState: vi.fn(),
    installEngine: vi.fn(),
    removeEngine: vi.fn(),
    preview: vi.fn(),
  };
  const config = { save: vi.fn(async (patch: unknown) => ({ config: patch })) };
  (window as unknown as { electronAPI: unknown }).electronAPI = { tts, config };
  return { tts, config };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  // 带上插值：徽标要断言百分比、预检理由要断言原因，不回键名就什么都验不到
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${Object.values(opts).join(",")}` : key,
  }),
}));

import { VoiceModeSettings } from "../../renderer/components/settings/VoiceModeSettings";
import { useAppStore } from "../../renderer/store";

/** jsdom 没有 WebAudio：够用的替身，`stop()` 会触发 onended（真实行为）。 */
class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  stopped = false;
  connect(): void {}
  start(): void {}
  stop(): void {
    this.stopped = true;
    this.onended?.();
  }
}

const created: FakeSource[] = [];

class FakeContext {
  state = "running";
  destination = {};
  createBuffer(): { getChannelData: () => { set: () => void } } {
    return { getChannelData: () => ({ set: () => {} }) };
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    created.push(source);
    return source;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

let container: HTMLDivElement;
let root: Root;
let emit: ((event: TtsEvent) => void) | null = null;

const IDLE: TtsInstallState = { phase: "idle", percent: 0, installed: false };
const READY: TtsInstallState = {
  phase: "ready",
  percent: 100,
  installed: true,
};
const ENGINE_IDLE: EngineInstallState = {
  phase: "idle",
  percent: 0,
  installed: false,
};
const ENGINE_READY: EngineInstallState = {
  phase: "ready",
  percent: 100,
  installed: true,
};

function setSherpa(states: Partial<TtsInstallStates> = {}): void {
  api.tts.getInstallState.mockResolvedValue({
    zh: IDLE,
    en: IDLE,
    matcha: IDLE,
    ...states,
  });
}

async function mount(
  opts: {
    tone?: "fast" | "balanced" | "best";
    engine?: EngineInstallState;
    states?: Partial<TtsInstallStates>;
    voiceEngineVoice?: string;
  } = {},
): Promise<void> {
  setSherpa(opts.states);
  api.tts.getEngineState.mockResolvedValue(opts.engine ?? ENGINE_IDLE);
  useAppStore.getState().setAppConfig({
    voiceMode: {
      silenceMs: 1200,
      fastVoice: opts.tone === "fast",
      tone: opts.tone ?? "balanced",
      ...(opts.voiceEngineVoice
        ? { voiceEngineVoice: opts.voiceEngineVoice }
        : {}),
    },
  } as AppConfig);
  await act(async () => {
    root.render(<VoiceModeSettings />);
  });
}

/** 取元素；没有就抛（比在断言里散落非空判断更好读）。 */
const byTestId = (id: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`missing element: ${id}`);
  return element;
};

/** 「它不该存在」的那几条断言用这个。 */
const queryTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const pickTone = (next: "fast" | "balanced" | "best") =>
  act(async () => {
    const select = byTestId("voice-voice-tone") as HTMLSelectElement;
    select.value = next;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

const optionValues = (id: string) =>
  Array.from(byTestId(id).querySelectorAll("option")).map((o) => o.value);

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("AudioContext", FakeContext);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  emit = null;
  api.tts.onEvent.mockImplementation((callback: (event: TtsEvent) => void) => {
    emit = callback;
    return () => {};
  });
  api.tts.preview.mockResolvedValue({
    ok: true,
    samples: new Float32Array([0.1, 0.2]),
    sampleRate: 24000,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("最佳音质档", () => {
  it("下拉里有三档；切到 best 不触发下载，只记住选择", async () => {
    await mount({ tone: "balanced", states: { zh: READY } });
    expect(optionValues("voice-voice-tone")).toEqual([
      "fast",
      "balanced",
      "best",
    ]);

    await pickTone("best");

    expect(api.tts.installEngine).not.toHaveBeenCalled();
    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: expect.objectContaining({ tone: "best", fastVoice: false }),
    });
  });

  it("未安装时：出现引擎行 + 音色下拉置灰 + 安装按钮；点了才装", async () => {
    await mount({ tone: "best" });

    const voice = byTestId("voice-engine-voice") as HTMLSelectElement;
    expect(voice.disabled).toBe(true);
    expect(queryTestId("voice-engine-remove")).toBeNull();

    await act(async () => {
      byTestId("voice-engine-install").click();
    });
    expect(api.tts.installEngine).toHaveBeenCalledOnce();
  });

  it("硬件不支持时不出现安装按钮（不能装着装着才发现跑不动）", async () => {
    await mount({
      tone: "best",
      engine: { ...ENGINE_IDLE, blockedReason: "memory" },
    });

    expect(queryTestId("voice-engine-install")).toBeNull();
    expect(byTestId("voice-engine-row")?.textContent).toContain(
      "settings.capabilities.voiceMode.toneBestBlockedMemory",
    );
  });

  it("装好后：九个音色可选（显示名来自模型元数据），切换写入配置", async () => {
    await mount({
      tone: "best",
      engine: ENGINE_READY,
      voiceEngineVoice: "ryan",
    });

    const voice = byTestId("voice-engine-voice") as HTMLSelectElement;
    expect(voice.disabled).toBe(false);
    expect(optionValues("voice-engine-voice")).toEqual([
      "serena",
      "vivian",
      "uncle_fu",
      "ryan",
      "aiden",
      "ono_anna",
      "sohee",
      "eric",
      "dylan",
    ]);
    // 方言后缀来自元数据，不是我们编的中文名
    expect(voice.textContent).toContain("sichuan_dialect");

    await act(async () => {
      voice.value = "dylan";
      voice.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: expect.objectContaining({ voiceEngineVoice: "dylan" }),
    });
  });

  it("引擎进度事件会更新徽标（不需要重读磁盘）", async () => {
    await mount({ tone: "best" });
    expect(byTestId("voice-engine-badge")?.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );

    await act(async () => {
      emit?.({
        type: "engine",
        state: { phase: "downloading", percent: 42, installed: false },
      });
    });
    expect(byTestId("voice-engine-badge")?.textContent).toContain("42");
  });
});

describe("试听", () => {
  it("均衡档点试听 → 走 tts.preview；播放中变「停止」，再点停", async () => {
    await mount({ tone: "balanced", states: { zh: READY } });
    const button = byTestId("voice-preview-balanced");
    expect(button.textContent).toBe(
      "settings.capabilities.voiceMode.tonePreview",
    );

    await act(async () => {
      button.click();
    });
    expect(api.tts.preview).toHaveBeenCalledWith("balanced");
    expect(byTestId("voice-preview-balanced").textContent).toBe(
      "settings.capabilities.voiceMode.tonePreviewStop",
    );

    await act(async () => {
      byTestId("voice-preview-balanced").click();
    });
    expect(created[0].stopped).toBe(true);
    expect(byTestId("voice-preview-balanced").textContent).toBe(
      "settings.capabilities.voiceMode.tonePreview",
    );
  });

  it("未安装时没有试听按钮（装了才有得听）", async () => {
    await mount({ tone: "balanced", states: { zh: IDLE } });
    expect(queryTestId("voice-preview-balanced")).toBeNull();
  });

  it("切档会停掉正在播的试听", async () => {
    await mount({ tone: "balanced", states: { zh: READY } });
    await act(async () => {
      byTestId("voice-preview-balanced").click();
    });
    expect(created).toHaveLength(1);

    await pickTone("fast");
    expect(created[0].stopped).toBe(true);
  });

  it("试听失败时给出可见的失败提示，而不是静默", async () => {
    api.tts.preview.mockResolvedValue({
      ok: false,
      error: "engine unavailable",
    });
    await mount({ tone: "best", engine: ENGINE_READY });

    await act(async () => {
      byTestId("voice-preview-best").click();
    });
    expect(byTestId("voice-preview-error")?.textContent).toBe(
      "settings.capabilities.voiceMode.tonePreviewFailed",
    );
  });

  it("引擎的试听把整句音频播出来（与另两档同一条路）", async () => {
    await mount({ tone: "best", engine: ENGINE_READY });
    await act(async () => {
      byTestId("voice-preview-best").click();
    });
    expect(api.tts.preview).toHaveBeenCalledWith("best");
  });
});

/** 未使用的类型导入护栏：流事件类型在别处用到，这里只做编译期占位。 */
export type _KeepStreamEvent = TtsStreamEvent;
