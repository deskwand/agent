// @vitest-environment jsdom
/**
 * 设置 →「能力」→ 语音对话卡里的「音色」行。
 *
 * 与 `read-aloud-settings.test.tsx` 同构：同一条安装器、同一套三段式状态行
 * （未安装 / 下载中 / 已安装 + 删除）。`t` 回键名，所以断言只看 testid 与调用。
 *
 * 这是高速音色**唯一**的安装入口（浮层里不做提示），所以它必须自己站得住：
 * 下载、进度、删除都要能走通。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsEvent, TtsInstallState } from "../../shared/ipc-types";
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

/** 其余两个模型的状态与本组件无关，给「未安装」即可。 */
function setStates(matcha: TtsInstallState): void {
  api.tts.getInstallState.mockResolvedValue({ zh: IDLE, en: IDLE, matcha });
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
  setStates(IDLE);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppStore.getState().setAppConfig(null);
  vi.unstubAllGlobals();
});

describe("VoiceModeSettings 的音色行", () => {
  it("未安装时给开关（开关就是下载入口）", async () => {
    await mount();

    expect(byTestId("voice-voice-row")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );
    expect(byTestId("voice-voice-toggle")).not.toBeNull();
    expect(byTestId("voice-voice-remove")).toBeNull();
  });

  it("renders off for a fresh user, and turning it on starts the download", async () => {
    // 默认偏好是 true，但模型没装 —— 开关必须显示为关，
    // 否则"已经开着"的开关没法启动下载（新用户只能靠 off→on 才猜到）。
    await mount();
    expect(byTestId("voice-voice-toggle")!.getAttribute("aria-checked")).toBe(
      "false",
    );

    await act(async () => byTestId("voice-voice-toggle")!.click());
    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: { silenceMs: 1200, fastVoice: true },
    });
    // 未装时顺手下载（与朗读那个开关同一行为）
    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("matcha");
  });

  it("turns the switch off without touching the model", async () => {
    // 已装 + 开着 → 点一下就是关：只写配置，不碰模型、不发 install
    setStates(READY);
    await mount();

    await act(async () => byTestId("voice-voice-toggle")!.click());
    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: { silenceMs: 1200, fastVoice: false },
    });
    expect(api.tts.install).not.toHaveBeenCalled();
    expect(api.tts.removeInstall).not.toHaveBeenCalled();
  });

  it("turning it back on with the model already installed does not download again", async () => {
    setStates(READY);
    await mount({ fastVoice: false });

    await act(async () => byTestId("voice-voice-toggle")!.click());
    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: { silenceMs: 1200, fastVoice: true },
    });
    // 装好的调用只会白推一条进度事件
    expect(api.tts.install).not.toHaveBeenCalled();
  });

  it("已安装时给删除入口，说明里写清代价", async () => {
    setStates(READY);
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("voice-voice-remove")).not.toBeNull();
    expect(byTestId("voice-voice-toggle")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.voiceMode.voiceFastDesc",
    );
  });

  it("删除调的是 matcha，删完重新读一次状态", async () => {
    setStates(READY);
    await mount();

    await act(async () => byTestId("voice-voice-remove")!.click());
    expect(api.tts.removeInstall).toHaveBeenCalledExactlyOnceWith("matcha");
    // 删完必须重读：删失败时留着原状态，界面才不会声称「已删除」
    expect(api.tts.getInstallState).toHaveBeenCalledTimes(2);
  });

  it("下载中显示进度条并收起按钮", async () => {
    await mount();

    await act(async () => {
      emit?.({ type: "install", model: "matcha", state: DOWNLOADING });
    });

    expect(byTestId("voice-voice-progress")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.downloading",
    );
    expect(byTestId("voice-voice-toggle")!.getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("offers retry after a failed download, with the switch still on", async () => {
    await mount();
    await act(async () => {
      emit?.({
        type: "install",
        model: "matcha",
        state: { phase: "error", percent: 0, installed: false, error: "boom" },
      });
    });

    // 装失败 → 意图还在，开关不能弹回关（否则重试按钮的前提就没了）
    expect(byTestId("voice-voice-toggle")!.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(byTestId("voice-voice-retry")).not.toBeNull();
    await act(async () => byTestId("voice-voice-retry")!.click());
    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("matcha");
  });

  it("hides retry when the user does not want the fast voice", async () => {
    // 下载中关掉、然后失败：开关是关的，那就不应该留一个会替用户下 123MB 的按钮
    await mount({ fastVoice: false });
    await act(async () => {
      emit?.({
        type: "install",
        model: "matcha",
        state: { phase: "error", percent: 0, installed: false, error: "boom" },
      });
    });

    expect(byTestId("voice-voice-toggle")!.getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(byTestId("voice-voice-retry")).toBeNull();
  });

  it("只认 matcha 的事件", async () => {
    await mount();

    await act(async () => {
      emit?.({ type: "install", model: "zh", state: DOWNLOADING });
    });

    // 朗读那两个模型的进度不该影响这一行
    expect(byTestId("voice-voice-progress")).toBeNull();
    expect(byTestId("voice-voice-toggle")).not.toBeNull();
  });

  it("shows the switch off when the config says off", async () => {
    useAppStore.getState().setAppConfig({
      voiceMode: { silenceMs: 800, fastVoice: false },
    } as AppConfig);
    setStates(READY);
    await mount();

    expect(byTestId("voice-voice-toggle")!.getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("keeps fastVoice off when the silence dropdown changes", async () => {
    // 写 voiceMode 是**整体替换**：只发 { silenceMs } 会把 fastVoice 打回默认 true，
    // 也就是旁边的下拉会悄悄替用户把开关打开。
    useAppStore.getState().setAppConfig({
      voiceMode: { silenceMs: 800, fastVoice: false },
    } as AppConfig);
    await mount();

    const select = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "2000";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(api.config.save).toHaveBeenCalledWith({
      voiceMode: { silenceMs: 2000, fastVoice: false },
    });
  });
});
