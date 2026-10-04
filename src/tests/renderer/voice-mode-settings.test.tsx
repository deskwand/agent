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

async function mount(): Promise<void> {
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
  it("未安装时给下载入口", async () => {
    await mount();

    expect(byTestId("voice-voice-row")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );
    expect(byTestId("voice-voice-install")).not.toBeNull();
    expect(byTestId("voice-voice-remove")).toBeNull();
  });

  it("点下载装的是 matcha", async () => {
    await mount();

    await act(async () => byTestId("voice-voice-install")!.click());
    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("matcha");
  });

  it("已安装时给删除入口，说明里写清代价", async () => {
    setStates(READY);
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("voice-voice-remove")).not.toBeNull();
    expect(byTestId("voice-voice-install")).toBeNull();
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
    expect(byTestId("voice-voice-install")).toBeNull();
  });

  it("只认 matcha 的事件", async () => {
    await mount();

    await act(async () => {
      emit?.({ type: "install", model: "zh", state: DOWNLOADING });
    });

    // 朗读那两个模型的进度不该影响这一行
    expect(byTestId("voice-voice-progress")).toBeNull();
    expect(byTestId("voice-voice-install")).not.toBeNull();
  });
});
