// @vitest-environment jsdom
/**
 * 设置 →「能力」里的朗读卡片。
 *
 * 与 `voice-capability-settings.test.tsx` 同构：同一条安装器、同一套三段式状态行
 * （未安装 / 下载中 / 已安装 + 删除）。`t` 回键名，所以断言只看 testid 与调用，
 * 不看中文文案。
 *
 * 两个模型（中文 zh / 英文 en）各占一行，各自有状态、按钮与进度条。
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
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;
/** 组件注册的事件回调：测试用它推安装进度。 */
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

/** 只填本组件会读的字段；setAppConfig 不做校验。 */
function setReadAloud(enabled: boolean): void {
  useAppStore.getState().setAppConfig({ readAloud: { enabled } } as AppConfig);
}

function setStates(zh: TtsInstallState, en: TtsInstallState): void {
  api.tts.getInstallState.mockResolvedValue({ zh, en });
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
  emit = null;
  api.tts.onEvent.mockImplementation((callback: (event: TtsEvent) => void) => {
    emit = callback;
    return () => {};
  });
  setStates(IDLE, IDLE);
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
    expect(byTestId("read-aloud-en-state")).toBeNull();
    expect(byTestId("read-aloud-en-install")).toBeNull();
  });

  it("打开但未安装时给下载入口", async () => {
    setReadAloud(true);
    await mount();

    expect(byTestId("read-aloud-state")).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );
    // 重启释放内存那句只出现在语音输入那张卡，这里不再重复
    expect(container.textContent).not.toContain(
      "settings.capabilities.memoryNote",
    );
    expect(byTestId("read-aloud-install")).not.toBeNull();
    expect(byTestId("read-aloud-remove")).toBeNull();
  });

  it("打开开关写配置并立刻开始下载中文模型", async () => {
    setReadAloud(false);
    await mount();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="read-aloud-toggle"]',
    )!;
    await act(async () => toggle.click());

    expect(api.config.save).toHaveBeenCalledWith({
      readAloud: { enabled: true },
    });
    // 开关只装中文（已是发布行为）；英文行由用户显式点
    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("zh");
  });

  it("未安装时点下载只调 install，不动配置", async () => {
    setReadAloud(true);
    await mount();

    await act(async () => byTestId("read-aloud-install")!.click());

    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("zh");
    expect(api.config.save).not.toHaveBeenCalled();
  });

  it("已安装时不再自动 install，只给删除入口", async () => {
    setReadAloud(true);
    setStates(READY, IDLE);
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("read-aloud-remove")).not.toBeNull();
    expect(byTestId("read-aloud-install")).toBeNull();

    // 删除后重新读一次状态：删掉的模型不该继续显示「已安装」。
    setStates(IDLE, IDLE);
    await act(async () => byTestId("read-aloud-remove")!.click());

    expect(api.tts.removeInstall).toHaveBeenCalledExactlyOnceWith("zh");
    expect(container.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );
  });

  it("下载中显示进度、不给按钮", async () => {
    setReadAloud(true);
    setStates(DOWNLOADING, IDLE);
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.downloading",
    );
    expect(byTestId("read-aloud-install")).toBeNull();
    expect(byTestId("read-aloud-remove")).toBeNull();
  });

  it("下载失败时如实说失败", async () => {
    setReadAloud(true);
    setStates(FAILED, IDLE);
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.failed",
    );
    expect(byTestId("read-aloud-install")).not.toBeNull();
  });

  it("下载中进度条与语音卡同款", async () => {
    setReadAloud(true);
    setStates(DOWNLOADING, IDLE);
    await mount();

    expect(byTestId("read-aloud-progress")).not.toBeNull();
    expect(
      byTestId("read-aloud-progress")!.querySelector('[role="progressbar"]'),
    ).not.toBeNull();
    expect(byTestId("read-aloud-badge")!.getAttribute("role")).toBe("status");
  });

  it("失败态用徽标 + 重试按钮，标题槽只放名词", async () => {
    setReadAloud(true);
    setStates(FAILED, IDLE);
    await mount();

    const row = byTestId("read-aloud-state")!;
    const titleNode = (row.firstElementChild as HTMLElement)
      .firstElementChild as HTMLElement;

    expect(titleNode.firstChild?.textContent).toBe(
      "settings.capabilities.readAloud.modelZh",
    );
    expect(byTestId("read-aloud-badge")!.textContent).toContain(
      "settings.capabilities.install.failed",
    );
    expect(byTestId("read-aloud-install")!.textContent).toContain(
      "settings.capabilities.install.retry",
    );
  });

  it("preload 缺 tts 时不崩，停在未安装", async () => {
    // 浏览器模式与测试里 preload 可能只有一部分字段；卡片要能自愈而不是白屏。
    const original = (window as unknown as { electronAPI: unknown })
      .electronAPI;
    (window as unknown as { electronAPI: unknown }).electronAPI = {};
    setReadAloud(true);

    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.notInstalled",
    );

    (window as unknown as { electronAPI: unknown }).electronAPI = original;
  });
});

describe("two voice model rows", () => {
  it("shows two independent rows with their own buttons", async () => {
    setReadAloud(true);
    setStates(READY, IDLE);
    await mount();

    expect(byTestId("read-aloud-state")).not.toBeNull();
    expect(byTestId("read-aloud-install")).toBeNull(); // 中文已装 → 删除按钮
    expect(byTestId("read-aloud-remove")).not.toBeNull();
    expect(byTestId("read-aloud-en-state")).not.toBeNull();
    expect(byTestId("read-aloud-en-install")).not.toBeNull(); // 英文未装 → 下载按钮
    expect(byTestId("read-aloud-en-remove")).toBeNull();
    // 两行各报自己的体积，卡头不再带数字
    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.zhNote",
    );
    expect(container.textContent).toContain(
      "settings.capabilities.readAloud.enNote",
    );
  });

  it("installs the model whose button was clicked", async () => {
    setReadAloud(true);
    setStates(READY, IDLE);
    await mount();

    await act(async () => byTestId("read-aloud-en-install")!.click());

    expect(api.tts.install).toHaveBeenCalledExactlyOnceWith("en");
  });

  it("updates only the row the event names", async () => {
    setReadAloud(true);
    setStates(READY, IDLE);
    await mount();

    await act(async () =>
      emit!({ type: "install", model: "en", state: DOWNLOADING }),
    );

    expect(byTestId("read-aloud-en-progress")).not.toBeNull();
    expect(byTestId("read-aloud-progress")).toBeNull();
    expect(byTestId("read-aloud-badge")!.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("read-aloud-en-badge")!.textContent).toContain(
      "settings.capabilities.install.downloading",
    );
  });

  it("gives the two download buttons different accessible names", async () => {
    setReadAloud(true);
    setStates(IDLE, IDLE);
    await mount();

    const zh = byTestId("read-aloud-install")!.getAttribute("aria-label");
    const en = byTestId("read-aloud-en-install")!.getAttribute("aria-label");
    expect(zh).toBe("settings.capabilities.readAloud.downloadZh");
    expect(en).toBe("settings.capabilities.readAloud.downloadEn");
    expect(zh).not.toBe(en);
  });

  it("removes only the row that was clicked", async () => {
    setReadAloud(true);
    setStates(READY, READY);
    await mount();

    setStates(READY, IDLE);
    await act(async () => byTestId("read-aloud-en-remove")!.click());

    expect(api.tts.removeInstall).toHaveBeenCalledExactlyOnceWith("en");
    expect(container.textContent).toContain(
      "settings.capabilities.install.installed",
    );
  });
});
