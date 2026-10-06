// @vitest-environment jsdom
/**
 * 设置 →「能力」里的 OCR 卡片：开关、下载、删除、进度。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../renderer/types";

const api = vi.hoisted(() => {
  const ocr = {
    getInstallState: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    install: vi.fn(),
    removeInstall: vi.fn(),
  };
  const config = { save: vi.fn() };
  (window as unknown as { electronAPI: unknown }).electronAPI = { ocr, config };
  return { ocr, config };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { OcrCapabilitySettings } from "../../renderer/components/settings/OcrCapabilitySettings";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

function setOcr(ocr: Partial<NonNullable<AppConfig["ocr"]>>): void {
  useAppStore
    .getState()
    .setAppConfig({ ocr: { enabled: false, ...ocr } } as AppConfig);
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<OcrCapabilitySettings />);
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
  api.ocr.getInstallState.mockResolvedValue({
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

describe("OcrCapabilitySettings", () => {
  it("关闭时只有开关一行", async () => {
    setOcr({ enabled: false });
    await mount();

    expect(byTestId("capability-ocr")).not.toBeNull();
    expect(byTestId("ocr-model")).toBeNull();
    expect(byTestId("ocr-install")).toBeNull();
  });

  it("打开时写配置并立刻开始下载", async () => {
    setOcr({ enabled: false });
    await mount();

    await act(async () => byTestId("ocr-enable")!.click());

    expect(api.config.save).toHaveBeenCalledWith({ ocr: { enabled: true } });
    expect(api.ocr.install).toHaveBeenCalledTimes(1);
  });

  it("已安装时只给删除入口，不再重复下载", async () => {
    setOcr({ enabled: true });
    api.ocr.getInstallState.mockResolvedValue({
      phase: "ready",
      percent: 100,
      installed: true,
    });
    await mount();

    expect(container.textContent).toContain(
      "settings.capabilities.install.installed",
    );
    expect(byTestId("ocr-install")).toBeNull();

    await act(async () => byTestId("ocr-remove")!.click());
    expect(api.ocr.removeInstall).toHaveBeenCalledTimes(1);
  });

  it("下载中显示进度条，不给按钮", async () => {
    setOcr({ enabled: true });
    api.ocr.getInstallState.mockResolvedValue({
      phase: "downloading",
      percent: 40,
      installed: false,
    });
    await mount();

    expect(byTestId("ocr-install-progress")).not.toBeNull();
    expect(byTestId("ocr-install")).toBeNull();
    expect(container.textContent).toContain(
      "settings.capabilities.install.downloading",
    );
  });

  it("下载失败时按钮变成重试，并说明内存要重启才归还", async () => {
    setOcr({ enabled: true });
    api.ocr.getInstallState.mockResolvedValue({
      phase: "error",
      percent: 0,
      installed: false,
      error: "boom",
    });
    await mount();

    expect(byTestId("ocr-install")!.textContent).toContain(
      "settings.capabilities.install.retry",
    );
    expect(container.textContent).toContain("settings.capabilities.memoryNote");
  });
});
