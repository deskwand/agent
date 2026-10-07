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
    retryEngine: vi.fn(),
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
import { openMenu, optionValues, pickOption } from "./settings-menu-helper";
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
  pickOption(container, "voice-voice-tone", next);

/** 打开菜单读一遍选项、再关掉（t 回键名，所以断言看的是 value）。 */
const readOptions = async (testId: string) => {
  await openMenu(container, testId);
  const values = optionValues(container, testId);
  await openMenu(container, testId);
  return values;
};

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
    expect(await readOptions("voice-voice-tone")).toEqual([
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

    const voice = byTestId("voice-engine-voice") as HTMLButtonElement;
    expect(voice.disabled).toBe(true);
    expect(queryTestId("voice-engine-remove")).toBeNull();

    await act(async () => {
      byTestId("voice-engine-install").click();
    });
    expect(api.tts.installEngine).toHaveBeenCalledOnce();
  });

  it("平台不支持（Windows/Linux 没产物）→ 整档都不出现", async () => {
    await mount({
      tone: "best",
      engine: { ...ENGINE_IDLE, blockedReason: "platform" },
    });

    // 下拉里只有两档，引擎行完全不渲染 —— 不是"灰着勾人"
    expect(await readOptions("voice-voice-tone")).toEqual(["fast", "balanced"]);
    expect(queryTestId("voice-engine-row")).toBeNull();
    expect(queryTestId("voice-engine-install")).toBeNull();
    // 说明文案也不该再提第三档
    expect(byTestId("voice-voice-row")?.textContent).toContain(
      "settings.capabilities.voiceMode.toneDescNoBest",
    );
    // 老配置写着 best、但这台机器装不了：按实际行为显示均衡（主进程也会回退）
    expect(byTestId("voice-voice-tone").textContent).toContain(
      "settings.capabilities.voiceMode.toneBalanced",
    );
  });

  it("磁盘/内存不够时仍然显示这一档，只是说明原因（用户能改）", async () => {
    await mount({
      tone: "best",
      engine: { ...ENGINE_IDLE, blockedReason: "disk" },
    });

    expect(await readOptions("voice-voice-tone")).toContain("best");
    expect(queryTestId("voice-engine-row")).not.toBeNull();
    expect(queryTestId("voice-engine-install")).toBeNull();
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

    const voice = byTestId("voice-engine-voice") as HTMLButtonElement;
    expect(voice.disabled).toBe(false);
    expect(await readOptions("voice-engine-voice")).toEqual([
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
    // 方言后缀来自元数据，不是我们编的中文名 —— 在菜单里才看得到
    await openMenu(container, "voice-engine-voice");
    expect(document.body.textContent).toContain("sichuan_dialect");
    await openMenu(container, "voice-engine-voice");

    await pickOption(container, "voice-engine-voice", "dylan");
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

  it("引擎被判 failed → 说明写清 + 有重试入口（不逼用户删了重下 900MB）", async () => {
    await mount({
      tone: "best",
      engine: { ...ENGINE_READY, status: "failed", phase: "error" },
    });

    expect(byTestId("voice-engine-badge")?.textContent).toContain(
      "settings.capabilities.install.failed",
    );
    expect(byTestId("voice-engine-row")?.textContent).toContain(
      "settings.capabilities.voiceMode.toneBestFailedNote",
    );

    await act(async () => {
      byTestId("voice-engine-reset").click();
    });
    expect(api.tts.retryEngine).toHaveBeenCalledOnce();
    expect(api.tts.installEngine).not.toHaveBeenCalled();
  });

  it("面板挂在 body 上，不在卡片里（卡片是 overflow-hidden，留在行里会被裁）", async () => {
    await mount({ tone: "best", engine: ENGINE_READY });

    const before = document.body.querySelectorAll('[role="menu"]').length;
    await openMenu(container, "voice-engine-voice");

    // 关键：面板**不在**行容器内 —— 在的话会被设置卡的圆角裁剪裁掉（截图里只露第一项）
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.body.querySelectorAll('[role="menu"]').length).toBe(
      before + 1,
    );
    // 九个音色都渲染出来了，不是被裁掉的那种"只有第一个"
    expect(optionValues(container, "voice-engine-voice")).toHaveLength(9);

    await openMenu(container, "voice-engine-voice"); // 关掉
  });

  it("试听按钮三态同宽：点一下不该把整行推得左右跳", async () => {
    // jsdom 量不了布局，所以钉住那条不变量本身：三种文案（试听/生成中/停止）下
    // 宽度 class 必须一致 —— 宽度一变就会挤动说明文字那列并让它重新折行。
    let resolvePreview: ((value: unknown) => void) | null = null;
    api.tts.preview.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    await mount({ tone: "balanced", states: { zh: READY } });

    const idle = byTestId("voice-preview-balanced").className;
    expect(idle).toContain("w-20");

    await act(async () => {
      byTestId("voice-preview-balanced").click(); // → 生成中（还挂着）
    });
    expect(byTestId("voice-preview-balanced").className).toContain("w-20");

    await act(async () => {
      resolvePreview?.({
        ok: true,
        samples: new Float32Array([0.1]),
        sampleRate: 24000,
      });
      await Promise.resolve();
    });
    expect(byTestId("voice-preview-balanced").className).toContain("w-20"); // → 停止
  });

  it("试听还在飞的时候切档 → 那次结果被丢掉，不播旧档的声音", async () => {
    let resolvePreview: ((value: unknown) => void) | null = null;
    api.tts.preview.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    await mount({ tone: "balanced", states: { zh: READY } });

    await act(async () => {
      byTestId("voice-preview-balanced").click(); // 进入 busy，请求还挂着
    });
    await pickTone("fast"); // 切档 → stop() 作废在飞请求

    await act(async () => {
      resolvePreview?.({
        ok: true,
        samples: new Float32Array([0.1]),
        sampleRate: 24000,
      });
      await Promise.resolve();
    });

    // 没有任何 source 被建出来 —— 旧档的声音没有冒出来
    expect(created).toHaveLength(0);
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
