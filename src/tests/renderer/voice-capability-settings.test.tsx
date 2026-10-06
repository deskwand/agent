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
    platform: "darwin",
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

/** 只填本组件会读的字段；其余给一份最小默认值（归一化保证运行时有 autoPolish）。 */
function setEngine(
  engine: Partial<NonNullable<AppConfig["voiceEngine"]>>,
): void {
  useAppStore.getState().setAppConfig({
    voiceEngine: { autoPolish: true, ...engine },
  } as AppConfig);
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<VoiceCapabilitySettings />);
  });
}

const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** 改渲染层看到的平台。默认 darwin，每个用例前会被重置。 */
function setPlatform(platform: string): void {
  (
    window as unknown as { electronAPI: { platform: string } }
  ).electronAPI.platform = platform;
}

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
  setPlatform("darwin");
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
    expect(byTestId("voice-auto-polish")).toBeNull();
  });

  it("打开时写配置并立刻开始安装", async () => {
    setEngine({ enabled: false, shortcut: "AltRight" });
    await mount();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="voice-enable"]',
    )!;
    await act(async () => toggle.click());

    expect(api.config.save).toHaveBeenCalledWith({
      voiceEngine: { autoPolish: true, enabled: true, shortcut: "AltRight" },
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

  it("内存要重启才归还这句，在语音模型这一行", async () => {
    // 反向断言（朗读卡里没有这句）在 read-aloud-settings.test.tsx
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
      voiceEngine: {
        autoPolish: true,
        enabled: true,
        shortcut: "MetaShiftSpace",
      },
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
  it("自动整理默认开，点一下关掉并写进配置", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    await mount();

    const row = byTestId("voice-auto-polish")!;
    expect(row.textContent).toContain(
      "settings.capabilities.voice.autoPolishDesc",
    );

    const toggle = row.querySelector<HTMLButtonElement>(
      '[data-testid="voice-auto-polish-switch"]',
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await act(async () => toggle.click());

    expect(api.config.save).toHaveBeenCalledWith({
      voiceEngine: { autoPolish: false, enabled: true, shortcut: "AltRight" },
    });
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

  it("快捷键选项按平台取键，行内提示两平台共用（darwin）", async () => {
    setEngine({ enabled: true, shortcut: "AltRight" });
    await mount();

    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "settings.capabilities.voice.shortcutAltRightMac",
      "settings.capabilities.voice.shortcutAltSpaceMac",
      "settings.capabilities.voice.shortcutMetaShiftSpaceMac",
      "settings.capabilities.voice.shortcutDisabled",
    ]);
    expect(byTestId("voice-shortcut")!.textContent).toContain(
      "settings.capabilities.voice.shortcutHint",
    );
  });

  it("选「不使用快捷键」时不给行提示：那时没有键在监听", async () => {
    setEngine({ enabled: true, shortcut: "disabled" });
    await mount();

    const row = byTestId("voice-shortcut")!;
    expect(row.textContent).toContain(
      "settings.capabilities.voice.shortcutDisabled",
    );
    expect(row.textContent).not.toContain(
      "settings.capabilities.voice.shortcutHint",
    );
  });

  it("win32 换成 Alt / Win 那套，行内提示不变", async () => {
    setPlatform("win32");
    setEngine({ enabled: true, shortcut: "AltRight" });
    await mount();

    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect(select.options[0].textContent).toBe(
      "settings.capabilities.voice.shortcutAltRightWin",
    );
    expect(select.options[1].textContent).toBe(
      "settings.capabilities.voice.shortcutAltSpaceWin",
    );
    expect(byTestId("voice-shortcut")!.textContent).toContain(
      "settings.capabilities.voice.shortcutHint",
    );
  });
});
