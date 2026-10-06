// @vitest-environment jsdom
/**
 * 「均衡」用的中文音色与朗读卡是**同一份模型**，不是两份 157MB。
 *
 * 这条契约只有在两张卡同时挂着时才看得见，所以单独一个文件：单卡测试各自都过，
 * 但「在一边删掉，另一边知道」是两张卡之间的约定。断了不会报错，症状是朗读卡
 * 还写着「已安装」而磁盘上已经没有了。
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

import { ReadAloudSettings } from "../../renderer/components/settings/ReadAloudSettings";
import { VoiceModeSettings } from "../../renderer/components/settings/VoiceModeSettings";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;
let listeners: Array<(event: TtsEvent) => void> = [];

const IDLE: TtsInstallState = { phase: "idle", percent: 0, installed: false };
const READY: TtsInstallState = {
  phase: "ready",
  percent: 100,
  installed: true,
};

/**
 * 磁盘上真实的状态。两张卡都读它，所以删完必须改它 —— 否则「重读一次」会读到旧值。
 * `matcha` 与英文音色跟本文件无关，一律未安装。
 */
let installed: { zh: boolean } = { zh: true };

const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** 主进程在装 / 删之后会推一条事件给**所有**订阅者。 */
const publish = (model: TtsEvent["model"], state: TtsInstallState) =>
  act(async () => {
    for (const listener of listeners)
      listener({ type: "install", model, state });
  });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  installed = { zh: true };
  listeners = [];

  api.tts.getInstallState.mockImplementation(async () => ({
    zh: installed.zh ? READY : IDLE,
    en: IDLE,
    matcha: IDLE,
  }));
  api.tts.onEvent.mockImplementation((callback: (event: TtsEvent) => void) => {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((entry) => entry !== callback);
    };
  });
  api.tts.removeInstall.mockImplementation(async (model: string) => {
    if (model === "zh") installed.zh = false;
  });

  useAppStore.getState().setAppConfig({
    readAloud: { enabled: true },
    // 均衡档才用中文音色 —— 快速档看的是 matcha，与本文件无关
    voiceMode: { silenceMs: 1200, fastVoice: false },
  } as AppConfig);

  await act(async () => {
    root.render(
      <>
        <ReadAloudSettings />
        <VoiceModeSettings />
      </>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppStore.getState().setAppConfig(null);
  vi.unstubAllGlobals();
});

describe("均衡与朗读共用同一份中文音色", () => {
  it("挂载时两张卡都报同一份模型的状态", () => {
    expect(byTestId("read-aloud-badge")!.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("voice-voice-badge")!.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    // 两份状态来自同一次读取，不该出现一边装好一边没装
    expect(api.tts.getInstallState).toHaveBeenCalledTimes(2);
  });

  it("在音色行删掉，朗读卡那行跟着变成未安装", async () => {
    await act(async () => byTestId("voice-voice-remove")!.click());
    expect(api.tts.removeInstall).toHaveBeenCalledExactlyOnceWith("zh");
    await publish("zh", IDLE);

    expect(byTestId("read-aloud-badge")!.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );
    expect(byTestId("read-aloud-install")).not.toBeNull();
    expect(byTestId("voice-voice-install")).not.toBeNull();
  });

  it("在朗读卡删掉，音色行也跟着变成未安装", async () => {
    await act(async () => byTestId("read-aloud-remove")!.click());
    await publish("zh", IDLE);

    expect(byTestId("voice-voice-badge")!.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );
    expect(byTestId("voice-voice-install")).not.toBeNull();
  });

  it("朗读卡那个开关始终不动 —— 删模型不等于关朗读", async () => {
    // 朗读开关有自己的语义（要不要朗读聊天回复）。删掉模型后它保持原样，
    // 只是下面那行显示「未安装」——界面不替用户改另一个设置。
    await act(async () => byTestId("voice-voice-remove")!.click());
    await publish("zh", IDLE);

    expect(byTestId("read-aloud-toggle")!.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(api.config.save).not.toHaveBeenCalled();
  });
});
