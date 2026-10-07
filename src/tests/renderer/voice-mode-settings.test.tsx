// @vitest-environment jsdom
/**
 * 设置 →「能力」→ 语音对话卡里的「音色」行。
 *
 * 两档模式，各带自己那份模型：快速 → matcha，均衡 → zh（与朗读共用同一份）。
 * 徽标、下载、删除都跟**当前选中的模式**走，所以每个用例都要同时说清
 * 「选的是哪档」和「两份模型各是什么状态」。
 *
 * 与 `read-aloud-settings.test.tsx` 同构：同一条安装器、同一套三段式状态行
 * （未安装 / 下载中 / 已安装 + 删除）。`t` 回键名，所以断言只看 testid 与调用。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TtsModelKey,
  TtsEvent,
  TtsInstallState,
  TtsInstallStates,
} from "../../shared/ipc-types";
import type { AppConfig } from "../../renderer/types";

const api = vi.hoisted(() => {
  const tts = {
    getInstallState: vi.fn(),
    onEvent: vi.fn(),
    install: vi.fn(),
    removeInstall: vi.fn(),
  };
  const config = { save: vi.fn() };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    tts,
    config,
  };
  return { tts, config };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { VoiceModeSettings } from "../../renderer/components/settings/VoiceModeSettings";
import { openMenu, optionValues, pickOption } from "./settings-menu-helper";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;
let emit: ((event: TtsEvent) => void) | null = null;

const IDLE: TtsInstallState = { phase: "idle", percent: 0, installed: false };
const READY: TtsInstallState = {
  phase: "ready",
  percent: 100,
  installed: true,
};
const DOWNLOADING: TtsInstallState = {
  phase: "downloading",
  percent: 42,
  installed: false,
};
const FAILED: TtsInstallState = {
  phase: "error",
  percent: 0,
  installed: false,
  error: "boom",
};

/** 只填本用例关心的那几份；其余按「未安装」。 */
function setStates(states: Partial<TtsInstallStates> = {}): void {
  api.tts.getInstallState.mockResolvedValue({
    zh: IDLE,
    en: IDLE,
    matcha: IDLE,
    ...states,
  });
}

/** 每个用例的脚手架。`fastVoice` 必须在这里给：下面那句 setState 会把 appConfig 清掉。 */
async function mount(opts: { fastVoice?: boolean } = {}): Promise<void> {
  if (opts.fastVoice !== undefined) {
    useAppStore.getState().setAppConfig({
      voiceMode: { silenceMs: 1200, fastVoice: opts.fastVoice },
    } as AppConfig);
  }
  await act(async () => {
    root.render(<VoiceModeSettings />);
  });
}

const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** 拨到某一档。自绘下拉：点开触发按钮再点选项。 */
const pickTone = (next: "fast" | "balanced") =>
  pickOption(container, "voice-voice-tone", next);

const emitInstall = (model: TtsModelKey, state: TtsInstallState) =>
  act(async () => {
    emit?.({ type: "install", model, state });
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  emit = null;
  api.tts.onEvent.mockImplementation((callback: (event: TtsEvent) => void) => {
    emit = callback;
    return () => {};
  });
  // 真的 config.save 回的是整份配置。界面的档位靠它回流，所以这里也要回。
  api.config.save.mockImplementation(async (patch: Partial<AppConfig>) => ({
    config: { ...useAppStore.getState().appConfig, ...patch } as AppConfig,
  }));
  setStates();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppStore.getState().setAppConfig(null);
  vi.unstubAllGlobals();
});

describe("VoiceModeSettings 的音色行", () => {
  it("未装时给下载入口，不给开关", async () => {
    await mount();

    expect(byTestId("voice-voice-row")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );
    expect(byTestId("voice-voice-install")).not.toBeNull();
    expect(byTestId("voice-voice-remove")).toBeNull();
  });

  it("切到「均衡」写配置，并下中文音色", async () => {
    await mount({ fastVoice: true });

    await pickTone("balanced");

    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: { silenceMs: 1200, fastVoice: false, tone: "balanced" },
    });
    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("zh");
  });

  it("切到「快速」写配置，并下高速音色", async () => {
    await mount({ fastVoice: false });

    await pickTone("fast");

    expect(api.config.save).toHaveBeenCalledWith({
      // tone 是事实来源，fastVoice 是它的镜像（老配置、老读者还认那个布尔值）
      voiceMode: { silenceMs: 1200, fastVoice: true, tone: "fast" },
    });
    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("matcha");
  });

  it("切到已装好的那一档不重复下载", async () => {
    // 装好的调用只会白推一条进度事件
    setStates({ matcha: READY });
    await mount({ fastVoice: false });

    await pickTone("fast");

    expect(api.config.save).toHaveBeenCalledWith({
      // tone 是事实来源，fastVoice 是它的镜像（老配置、老读者还认那个布尔值）
      voiceMode: { silenceMs: 1200, fastVoice: true, tone: "fast" },
    });
    expect(api.tts.install).not.toHaveBeenCalled();
  });

  it("均衡选中时，删除调的是中文音色", async () => {
    setStates({ zh: READY });
    await mount({ fastVoice: false });

    await act(async () => byTestId("voice-voice-remove")!.click());

    expect(api.tts.removeInstall).toHaveBeenCalledExactlyOnceWith("zh");
    // 删完必须重读：删失败时留着原状态，界面才不会声称「已删除」
    expect(api.tts.getInstallState).toHaveBeenCalledTimes(2);
  });

  it("快速选中时，删除调的是高速音色", async () => {
    setStates({ matcha: READY });
    await mount();

    await act(async () => byTestId("voice-voice-remove")!.click());

    expect(api.tts.removeInstall).toHaveBeenCalledExactlyOnceWith("matcha");
  });

  it("给的是元数据里那一档的按钮，不是另一档的", async () => {
    // 快速选中、matcha 已装，但 zh 未装 —— 删除按钮必须指 matcha
    setStates({ matcha: READY });
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("voice-voice-remove")).not.toBeNull();
    expect(byTestId("voice-voice-install")).toBeNull();
  });

  it("下载按钮的无障碍名称说的是它自己，不是行标题", async () => {
    // aria-label 会**覆盖**可见文字：报成「音色」的话，屏幕上写着「下载」、念「下载」
    // 的语音控制用户却点不到它（WCAG 2.5.3 Label in Name），而且与旁边那个下拉同名。
    await mount();

    expect(byTestId("voice-voice-install")!.getAttribute("aria-label")).toBe(
      "settings.capabilities.voiceMode.toneDownloadFast",
    );
  });

  it("重试按钮的无障碍名称带「重试」那一份", async () => {
    await mount({ fastVoice: false });

    await emitInstall("zh", FAILED);

    expect(byTestId("voice-voice-retry")!.getAttribute("aria-label")).toBe(
      "settings.capabilities.voiceMode.toneRetryZh",
    );
  });

  it("下载中显示进度条并收起按钮", async () => {
    await mount();

    await emitInstall("matcha", DOWNLOADING);

    expect(byTestId("voice-voice-progress")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.downloading",
    );
    expect(byTestId("voice-voice-install")).toBeNull();
  });

  it("失败后给重试，重试下的还是这一档那份", async () => {
    await mount({ fastVoice: false });

    await emitInstall("zh", FAILED);

    expect(byTestId("voice-voice-retry")).not.toBeNull();
    await act(async () => byTestId("voice-voice-retry")!.click());
    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("zh");
  });

  it("只显示当前档那份模型的状态", async () => {
    // 均衡选中时，matcha 的进度与失败都不归这一行 —— 它是另一档的东西
    setStates({ zh: READY });
    await mount({ fastVoice: false });

    await emitInstall("matcha", DOWNLOADING);
    await emitInstall("matcha", FAILED);

    expect(byTestId("voice-voice-progress")).toBeNull();
    expect(byTestId("voice-voice-retry")).toBeNull();
    expect(byTestId("voice-voice-remove")).not.toBeNull();
  });

  it("切档后立刻显示新那一档的状态，不必重读磁盘", async () => {
    // 两份状态都订阅着，切过去就能用
    setStates({ matcha: READY });
    await mount({ fastVoice: false });

    expect(byTestId("voice-voice-install")).not.toBeNull();

    await pickTone("fast");

    expect(byTestId("voice-voice-remove")).not.toBeNull();
  });

  it("改档不会丢掉配置里的其它字段（voiceMode 是整体替换）", async () => {
    // 写 voiceMode 是**整体替换**：写入方必须带上另一个字段，否则会把它打回默认。
    // 原用例挂在静音行上，那一行已删除 —— 同一条守卫改挂档位行。
    // 选第三档正好不需要伪造引擎安装状态：1.5GB 不该被下拉静默触发，它只记住选择。
    useAppStore.getState().setAppConfig({
      voiceMode: { silenceMs: 800, fastVoice: false, tone: "balanced" },
    } as AppConfig);
    await mount();

    await pickOption(container, "voice-voice-tone", "best");

    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: { silenceMs: 800, fastVoice: false, tone: "best" },
    });
  });

  it("语速可改、风格可清空，且都不丢其它字段", async () => {
    useAppStore.getState().setAppConfig({
      voiceMode: {
        silenceMs: 1200,
        fastVoice: false,
        tone: "best",
        voiceSpeed: 1.25,
        voiceStyle: "嗲一点",
      },
    } as AppConfig);
    await mount();

    // 语速行可改：写回时其它字段一个都不能丢（voiceMode 是整体替换）
    await pickOption(container, "voice-speed", "1.5");
    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: {
        silenceMs: 1200,
        fastVoice: false,
        tone: "best",
        voiceSpeed: 1.5,
        voiceStyle: "嗲一点",
      },
    });

    // 风格由模型写入，界面只显示 + 提供清空
    expect(container.textContent).toContain("嗲一点");
    await act(async () => {
      byTestId("voice-style-clear")!.click();
    });
    expect(api.config.save).toHaveBeenLastCalledWith({
      voiceMode: {
        silenceMs: 1200,
        fastVoice: false,
        tone: "best",
        voiceSpeed: 1.5,
        voiceStyle: "",
      },
    });
  });

  it("语速不在预设里时也显示得出来（模型可以写 0.8）", async () => {
    useAppStore.getState().setAppConfig({
      voiceMode: { silenceMs: 1200, fastVoice: false, voiceSpeed: 0.8 },
    } as AppConfig);
    await mount();

    await openMenu(container, "voice-speed");
    expect(optionValues("voice-speed")).toContain("0.8");
  });

  it("卡片接的是共用说明；档位行与子行各用各的 key；静音行整行消失", async () => {
    // 这个 harness 不加载 i18n（渲染出来是 key 原文），所以这里只断**结构**：
    // 用了哪个 key、哪一行在不在。文案**值**由 src/tests/i18n/voice-card-copy.test.ts 保证。
    await mount();
    const text = container.textContent ?? "";

    expect(text).toContain("settings.capabilities.voiceMode.title");
    expect(text).toContain("settings.capabilities.voiceMode.desc");
    // 两行各接自己的 key（此前它们的中文值都叫「音色」，所以撞名）
    expect(text).toContain("settings.capabilities.voiceMode.tone");
    // 子行（最佳档音色）只在装了引擎时渲染，它的文案值由 T1 的 i18n 用例保证，
    // 这里不伪造引擎安装状态。

    // 静音判停行整行删除：DOM 上没有它，也没有它那两个字面量 key
    expect(
      container.querySelector('[data-testid="voice-mode-silence"]'),
    ).toBeNull();
    expect(text).not.toContain("settings.capabilities.voiceMode.silenceLabel");
  });
});
