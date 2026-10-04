// @vitest-environment jsdom
/**
 * 「引擎就绪」这一层：点麦克风之后到底写不写配置、下不下载、这次能不能开始录音。
 *
 * 替身必须能表达真实的三件可变事实（已装 / 未装、启用 / 未启用、用户答什么），
 * 静态替身会把这个分支逻辑整个藏起来。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { VoiceInstallState } from "../../shared/ipc-types";
import type { AppConfig } from "../../renderer/types";

const api = vi.hoisted(() => ({
  voice: {
    getInstallState: vi.fn(),
    onEvent: vi.fn(),
    install: vi.fn(),
  },
  config: { save: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useVoiceEngine } from "../../renderer/hooks/useVoiceEngine";
import { useAppStore } from "../../renderer/store";

const INSTALLED: VoiceInstallState = {
  phase: "ready",
  percent: 100,
  installed: true,
};
const MISSING: VoiceInstallState = {
  phase: "idle",
  percent: 0,
  installed: false,
};

let engine: ReturnType<typeof useVoiceEngine>;
let onReady: Mock<() => void>;
let onEnableFailed: Mock<() => void>;
let emit: (event: unknown) => void;
let container: HTMLDivElement;
let root: Root;

function Probe() {
  engine = useVoiceEngine({ onReady, onEnableFailed });
  return React.createElement("span", null, engine.install?.phase ?? "none");
}

const mount = async () =>
  act(async () => root.render(React.createElement(Probe)));

const setEnabled = (enabled: boolean) =>
  useAppStore.getState().setAppConfig({
    voiceEngine: { enabled, shortcut: "AltRight" },
  } as AppConfig);

/** 点麦克风的那一段调用：不等用户，只在主进程那一次 IPC 上 await。 */
async function callEnsureReady(): Promise<boolean | undefined> {
  let result: boolean | undefined;
  await act(async () => {
    result = await engine.ensureReady();
  });
  return result;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  onReady = vi.fn<() => void>();
  onEnableFailed = vi.fn<() => void>();
  emit = () => {};
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    voice: api.voice,
    config: api.config,
  };
  api.voice.onEvent.mockImplementation((cb: (e: unknown) => void) => {
    emit = cb;
    return () => {};
  });
  api.voice.getInstallState.mockResolvedValue(MISSING);
  api.config.save.mockImplementation(async (input: unknown) => ({
    config: input,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppStore.getState().setAppConfig(null);
});

describe("useVoiceEngine.ensureReady", () => {
  it("没装：把确认摆出来，这次不录音，什么都不写", async () => {
    await mount();
    setEnabled(false);

    expect(await callEnsureReady()).toBe(false);
    expect(engine.confirmOpen).toBe(true);
    expect(api.config.save).not.toHaveBeenCalled();
    expect(api.voice.install).not.toHaveBeenCalled();
  });

  it("答「下载并开启」：写配置 + 起下载 + 关弹窗", async () => {
    await mount();
    setEnabled(false);
    await callEnsureReady();

    await act(async () => engine.confirmDownload());

    expect(engine.confirmOpen).toBe(false);
    expect(api.config.save).toHaveBeenCalledWith({
      voiceEngine: { enabled: true, shortcut: "AltRight" },
    });
    expect(api.voice.install).toHaveBeenCalledTimes(1);
  });

  it("答「取消」：只关弹窗，不写配置、不下载", async () => {
    await mount();
    setEnabled(false);
    await callEnsureReady();

    await act(async () => engine.cancelDownload());

    expect(engine.confirmOpen).toBe(false);
    expect(api.config.save).not.toHaveBeenCalled();
    expect(api.voice.install).not.toHaveBeenCalled();
  });

  it("弹窗开着时再点麦克风：不叠第二个，也不抢先写配置", async () => {
    await mount();
    setEnabled(false);

    await callEnsureReady();
    expect(await callEnsureReady()).toBe(false);
    expect(engine.confirmOpen).toBe(true);

    await act(async () => engine.confirmDownload());
    expect(api.voice.install).toHaveBeenCalledTimes(1);
  });

  it("已装但没启用：写配置就直接录，不弹确认（不下载就不问）", async () => {
    api.voice.getInstallState.mockResolvedValue(INSTALLED);
    await mount();
    setEnabled(false);

    expect(await callEnsureReady()).toBe(true);
    expect(engine.confirmOpen).toBe(false);
    expect(api.config.save).toHaveBeenCalledWith({
      voiceEngine: { enabled: true, shortcut: "AltRight" },
    });
    expect(api.voice.install).not.toHaveBeenCalled();
  });

  it("已装且已启用：什么都不改（读的是 store 最新值，不是渲染快照）", async () => {
    api.voice.getInstallState.mockResolvedValue(INSTALLED);
    await mount();
    // 挂载之后才启用：实现若读渲染时的快照，这里会多写一次配置。
    setEnabled(true);

    expect(await callEnsureReady()).toBe(true);
    expect(api.config.save).not.toHaveBeenCalled();
    expect(api.voice.install).not.toHaveBeenCalled();
  });

  it("下载进行中再点麦克风：不弹确认，也不再下一次（快捷键走得到这条）", async () => {
    api.voice.getInstallState.mockResolvedValue({
      phase: "downloading",
      percent: 45,
      installed: false,
    });
    await mount();
    setEnabled(true);

    expect(await callEnsureReady()).toBe(false);
    expect(engine.confirmOpen).toBe(false);
    expect(api.config.save).not.toHaveBeenCalled();
    expect(api.voice.install).not.toHaveBeenCalled();
  });

  it("写配置失败：报一次，不开始录音", async () => {
    api.voice.getInstallState.mockResolvedValue(INSTALLED);
    api.config.save.mockRejectedValue(new Error("disk full"));
    await mount();
    setEnabled(false);

    expect(await callEnsureReady()).toBe(false);
    expect(onEnableFailed).toHaveBeenCalledTimes(1);
  });

  it("写配置失败（答了下载）：报一次，且不下载", async () => {
    api.config.save.mockRejectedValue(new Error("disk full"));
    await mount();
    setEnabled(false);
    await callEnsureReady();

    await act(async () => engine.confirmDownload());

    expect(onEnableFailed).toHaveBeenCalledTimes(1);
    expect(api.voice.install).not.toHaveBeenCalled();
  });

  it("没有 voice API：返回 false，不炸", async () => {
    await mount();
    (window as unknown as { electronAPI: unknown }).electronAPI = undefined;

    expect(await callEnsureReady()).toBe(false);
  });

  it("getInstallState 抛错：按「未就绪」处理，不当前装过", async () => {
    api.voice.getInstallState.mockRejectedValue(new Error("boom"));
    await mount();
    setEnabled(false);

    expect(await callEnsureReady()).toBe(false);
    expect(api.voice.install).not.toHaveBeenCalled();
  });
});

describe("useVoiceEngine 的安装态订阅", () => {
  it("首帧取一次状态；install 事件落 ready 时回调一次 onReady", async () => {
    await mount();
    expect(api.voice.getInstallState).toHaveBeenCalledTimes(1);
    // 首帧那次读取已经落进 state：MISSING 的 phase 是 idle。
    expect(container.textContent).toBe("idle");

    await act(async () => emit({ type: "install", state: INSTALLED }));

    expect(container.textContent).toBe("ready");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("事件不是 ready（下载中）时不报「已就绪」", async () => {
    await mount();

    await act(async () =>
      emit({
        type: "install",
        state: { phase: "downloading", percent: 45, installed: false },
      }),
    );

    expect(onReady).not.toHaveBeenCalled();
    expect(container.textContent).toBe("downloading");
  });
});
