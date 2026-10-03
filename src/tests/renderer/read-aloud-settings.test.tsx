// @vitest-environment jsdom
/**
 * 设置 →「能力」里的朗读卡片。
 *
 * 与 `voice-capability-settings.test.tsx` 同构：同一条安装器、同一套三段式状态行
 * （未安装 / 下载中 / 已安装 + 删除）。`t` 回键名，所以断言只看 testid 与调用，
 * 不看中文文案。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../renderer/types";

const api = vi.hoisted(() => {
  const tts = {
    getInstallState: vi.fn(),
    onEvent: vi.fn(() => () => {}),
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
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

/** 只填本组件会读的字段；setAppConfig 不做校验。 */
function setReadAloud(enabled: boolean): void {
  useAppStore.getState().setAppConfig({ readAloud: { enabled } } as AppConfig);
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<ReadAloudSettings />);
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
  api.tts.getInstallState.mockResolvedValue({
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
  vi.unstubAllGlobals();
});

describe("ReadAloudSettings", () => {
  it("关闭时只显示开关一行，不显示安装状态", async () => {
    setReadAloud(false);
    await mount();

    expect(byTestId("read-aloud-card")).not.toBeNull();
    expect(byTestId("read-aloud-state")).toBeNull();
    expect(byTestId("read-aloud-install")).toBeNull();
  });

  it("打开但未安装时给下载入口，并说明内存代价", async () => {
    setReadAloud(true);
    await mount();

    expect(byTestId("read-aloud-state")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.notInstalled",
    );
    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.memoryNote",
    );
    expect(byTestId("read-aloud-install")).not.toBeNull();
    expect(byTestId("read-aloud-remove")).toBeNull();
  });

  it("打开开关写配置并立刻开始下载", async () => {
    setReadAloud(false);
    await mount();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="read-aloud-toggle"]',
    )!;
    await act(async () => toggle.click());

    expect(api.config.save).toHaveBeenCalledWith({
      readAloud: { enabled: true },
    });
    expect(api.tts.install).toHaveBeenCalledTimes(1);
  });

  it("未安装时点下载只调 install，不动配置", async () => {
    setReadAloud(true);
    await mount();

    await act(async () => byTestId("read-aloud-install")!.click());

    expect(api.tts.install).toHaveBeenCalledTimes(1);
    expect(api.config.save).not.toHaveBeenCalled();
  });

  it("已安装时不再自动 install，只给删除入口", async () => {
    setReadAloud(true);
    api.tts.getInstallState.mockResolvedValue({
      phase: "ready",
      percent: 100,
      installed: true,
    });
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.installed",
    );
    expect(byTestId("read-aloud-remove")).not.toBeNull();
    expect(byTestId("read-aloud-install")).toBeNull();

    // 删除后重新读一次状态：删掉的模型不该继续显示「已安装」。
    api.tts.getInstallState.mockResolvedValue({
      phase: "idle",
      percent: 0,
      installed: false,
    });
    await act(async () => byTestId("read-aloud-remove")!.click());

    expect(api.tts.removeInstall).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.notInstalled",
    );
  });

  it("下载中显示进度、不给按钮", async () => {
    setReadAloud(true);
    api.tts.getInstallState.mockResolvedValue({
      phase: "downloading",
      percent: 42,
      installed: false,
    });
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.installing",
    );
    expect(byTestId("read-aloud-install")).toBeNull();
    expect(byTestId("read-aloud-remove")).toBeNull();
  });

  it("下载失败时如实说失败", async () => {
    setReadAloud(true);
    api.tts.getInstallState.mockResolvedValue({
      phase: "error",
      percent: 0,
      installed: false,
      error: "boom",
    });
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.installFailed",
    );
    expect(byTestId("read-aloud-install")).not.toBeNull();
  });

  it("preload 缺 tts 时不崩，停在未安装", async () => {
    // 浏览器模式与测试里 preload 可能只有一部分字段；卡片要能自愈而不是白屏。
    const original = (window as unknown as { electronAPI: unknown })
      .electronAPI;
    (window as unknown as { electronAPI: unknown }).electronAPI = {};
    setReadAloud(true);

    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.notInstalled",
    );

    (window as unknown as { electronAPI: unknown }).electronAPI = original;
  });
});
