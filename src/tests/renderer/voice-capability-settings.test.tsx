// @vitest-environment jsdom
/**
 * 设置 →「能力」里的语音卡片。
 *
 * 为什么之前没有：Task 11 的 agent 撞了轮次上限，卡片本体（toggle / 安装 / 删除 /
 * 快捷键）从未被测过 —— 而本轮所有真 bug 都长在无测试的表面上。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../renderer/types";

const api = vi.hoisted(() => {
  const voice = {
    getInstallState: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    install: vi.fn(),
    removeInstall: vi.fn(),
  };
  const config = { save: vi.fn() };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    voice,
    config,
  };
  return { voice, config };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { VoiceCapabilitySettings } from "../../renderer/components/settings/VoiceCapabilitySettings";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

/** 只填本组件会读的字段；setAppConfig 不做校验。 */
function setEngine(engine: AppConfig["voiceEngine"]): void {
  useAppStore.getState().setAppConfig({ voiceEngine: engine } as AppConfig);
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<VoiceCapabilitySettings />);
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
  api.voice.getInstallState.mockResolvedValue({
    phase: "idle",
    percent: 0,
    installed: false,
  });
  api.config.save.mockImplementation(async (input: unknown) => ({
    config: input,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppStore.getState().setAppConfig(null);
});

describe("VoiceCapabilitySettings", () => {
  it("关闭时只显示开关一行，不显示安装与快捷键", async () => {
    setEngine({ enabled: false, shortcut: "AltRight" });
    await mount();

    expect(byTestId("capability-voice")).not.toBeNull();
    expect(byTestId("voice-engine")).toBeNull();
    expect(byTestId("voice-shortcut")).toBeNull();
  });

  it("打开时写配置并立刻开始安装", async () => {
    setEngine({ enabled: false, shortcut: "AltRight" });
    await mount();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="voice-enable"]',
    )!;
    await act(async () => toggle.click());

    expect(api.config.save).toHaveBeenCalledWith({
      voiceEngine: { enabled: true, shortcut: "AltRight" },
    });
    expect(api.voice.install).toHaveBeenCalledTimes(1);
  });

  it("已安装时不再重复调 install，只给一个删除入口", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    api.voice.getInstallState.mockResolvedValue({
      phase: "ready",
      percent: 100,
      installed: true,
    });
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("voice-remove")).not.toBeNull();
    expect(byTestId("voice-install")).toBeNull();

    await act(async () => byTestId("voice-remove")!.click());
    expect(api.voice.removeInstall).toHaveBeenCalledTimes(1);
  });

  it("内存要重启才归还，这一句两个本机功能都要有", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    api.voice.getInstallState.mockResolvedValue({
      phase: "ready",
      percent: 100,
      installed: true,
    });
    await mount();

    expect(container.textContent).toContain("settings.capabilities.memoryNote");
  });

  it("未安装时给安装按钮，点了就装", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    await mount();

    expect(byTestId("voice-install")).not.toBeNull();
    await act(async () => byTestId("voice-install")!.click());

    expect(api.voice.install).toHaveBeenCalledTimes(1);
  });

  it("安装中显示进度、不显示按钮", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    api.voice.getInstallState.mockResolvedValue({
      phase: "downloading",
      percent: 42,
      installed: false,
    });
    await mount();

    expect(byTestId("voice-install-progress")).not.toBeNull();
    expect(
      byTestId("voice-install-progress")!.querySelector('[role="progressbar"]'),
    ).not.toBeNull();
    // 状态自己会变，所以它是 live region：下载期间读屏用户要听得到。
    expect(byTestId("voice-engine-badge")!.getAttribute("role")).toBe("status");
    expect(byTestId("voice-install")).toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.downloading",
    );
  });

  it("状态进徽标，标题槽只放名词（失败态给重试）", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    api.voice.getInstallState.mockResolvedValue({
      phase: "error",
      percent: 0,
      installed: false,
      error: "boom",
    });
    await mount();

    const row = byTestId("voice-engine")!;
    const titleNode = (row.firstElementChild as HTMLElement)
      .firstElementChild as HTMLElement;

    expect(titleNode.firstChild?.textContent).toBe(
      "settings.capabilities.voice.model",
    );
    expect(byTestId("voice-engine-badge")!.textContent).toContain(
      "settings.capabilities.install.failed",
    );
    expect(byTestId("voice-install")!.textContent).toContain(
      "settings.capabilities.install.retry",
    );
    // 快捷键行也是子行
    expect(byTestId("voice-shortcut")!.firstElementChild!.className).toContain(
      "pl-4",
    );
  });

  it("改快捷键写配置，且带上当前的 enabled", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    api.voice.getInstallState.mockResolvedValue({
      phase: "ready",
      percent: 100,
      installed: true,
    });
    await mount();

    const select = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "MetaShiftSpace";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(api.config.save).toHaveBeenCalledWith({
      voiceEngine: { enabled: true, shortcut: "MetaShiftSpace" },
    });
  });

  it("preload 缺 voice 时不崩，停在未安装", async () => {
    // 浏览器模式与测试里 preload 可能不完整；卡片要能自愈而不是白屏。
    const original = (window as unknown as { electronAPI: unknown })
      .electronAPI;
    (window as unknown as { electronAPI: unknown }).electronAPI = {};
    setEngine({ enabled: true, shortcut: "AltRight" });

    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );

    (window as unknown as { electronAPI: unknown }).electronAPI = original;
  });
  it("children 渲染在卡片里，且开关关闭时也在", async () => {
    setEngine({ enabled: false, shortcut: "AltRight" });
    await act(async () => {
      root.render(
        <VoiceCapabilitySettings>
          <div data-testid="injected-child" />
        </VoiceCapabilitySettings>,
      );
    });

    const parent = byTestId("capability-voice")!;
    expect(byTestId("injected-child")).not.toBeNull();
    expect(parent.closest(".rounded-container")).toBe(
      byTestId("injected-child")!.closest(".rounded-container"),
    );
  });
});
