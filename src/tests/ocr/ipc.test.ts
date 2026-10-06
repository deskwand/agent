import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerOcrIpc } from "../../main/ocr/ipc";
import type { OcrInstallOptions } from "../../main/ocr/installer";
import type { OcrEvent } from "../../shared/ipc-types";

type Handler = (event: unknown, payload?: unknown) => unknown;

let userDataPath = "";
let handlers: Map<string, Handler>;
let events: OcrEvent[];

function fakeIpcMain() {
  return {
    handle: (channel: string, handler: Handler) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  };
}

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), "ocr-ipc-"));
  handlers = new Map();
  events = [];
});
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }));

function deps(overrides: Record<string, unknown> = {}) {
  /** 三平台的键都给全：单测在哪个平台上跑都能拿到值。 */
  const keys = ["darwin-arm64", "win32-x64", "linux-x64"];
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcMain: fakeIpcMain() as any,
    userDataPath,
    sendEvent: (event: OcrEvent) => {
      events.push(event);
    },
    readSpec: () => ({
      modelUrl: "https://example.com/model.tar.gz",
      modelSha256: "a".repeat(64),
      runtimeUrl: Object.fromEntries(
        keys.map((key) => [key, `https://example.com/${key}.tar.gz`]),
      ),
      runtimeSha256: Object.fromEntries(
        keys.map((key) => [key, "b".repeat(64)]),
      ),
    }),
    install: vi.fn(async (opts: OcrInstallOptions) => {
      opts.onPhase("downloading");
      opts.onProgress(0);
      opts.onProgress(100);
    }),
    isInstalled: vi.fn(() => false),
    remove: vi.fn(),
    selfCheck: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("ocr ipc", () => {
  it("getInstallState 报告未安装", async () => {
    registerOcrIpc(deps());
    const state = await handlers.get("ocr.getInstallState")!(null);
    expect(state).toEqual({ phase: "idle", percent: 0, installed: false });
  });

  it("已安装时启动状态就是 ready", async () => {
    registerOcrIpc(deps({ isInstalled: vi.fn(() => true) }));
    const state = await handlers.get("ocr.getInstallState")!(null);
    expect(state).toEqual({ phase: "ready", percent: 100, installed: true });
  });

  it("install 成功 → 走 downloading/extracting → 自检 → ready", async () => {
    const d = deps();
    registerOcrIpc(d);
    await handlers.get("ocr.install")!(null);

    expect(d.install).toHaveBeenCalledOnce();
    expect(d.selfCheck).toHaveBeenCalledOnce();
    const phases = events.map((event) => event.state.phase);
    expect(phases).toContain("downloading");
    expect(phases.at(-1)).toBe("ready");
    expect(events.at(-1)).toEqual({
      type: "install",
      state: { phase: "ready", percent: 100, installed: true },
    });
  });

  it("自检失败 → 回滚并推 error", async () => {
    const d = deps({
      selfCheck: vi.fn(async () => {
        throw new Error("ort 加载失败");
      }),
    });
    registerOcrIpc(d);
    await handlers.get("ocr.install")!(null);

    expect(d.remove).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({
      type: "install",
      state: { phase: "error", installed: false, error: "ort 加载失败" },
    });
  });

  it("已装时 install 直接返回，不重复下载", async () => {
    const d = deps({ isInstalled: vi.fn(() => true) });
    registerOcrIpc(d);
    await handlers.get("ocr.install")!(null);
    expect(d.install).not.toHaveBeenCalled();
  });

  it("removeInstall 清空状态", async () => {
    const d = deps({ isInstalled: vi.fn(() => true) });
    registerOcrIpc(d);
    await handlers.get("ocr.removeInstall")!(null);
    expect(d.remove).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({
      type: "install",
      state: { phase: "idle", percent: 0, installed: false },
    });
  });
});

describe("ocr ipc — 安装态是外部可变的", () => {
  it("文件被删后 getInstallState 不再报已安装", async () => {
    const installed = vi.fn(() => true);
    // 第一次问还有文件；用户手工删掉之后，第二次问必须改口
    registerOcrIpc(deps({ isInstalled: installed }));
    expect(await handlers.get("ocr.getInstallState")!(null)).toMatchObject({
      installed: true,
      phase: "ready",
    });

    installed.mockReturnValue(false);
    expect(await handlers.get("ocr.getInstallState")!(null)).toEqual({
      phase: "idle",
      percent: 0,
      installed: false,
    });
  });

  it("装好之后 getInstallState 立刻能读到已安装", async () => {
    let installed = false;
    registerOcrIpc(deps({ isInstalled: vi.fn(() => installed) }));
    await handlers.get("ocr.install")!(null);

    installed = true;
    expect(await handlers.get("ocr.getInstallState")!(null)).toMatchObject({
      installed: true,
      phase: "ready",
    });
  });

  it("下载中不受文件检查影响，仍然报下载进度", async () => {
    let installed = false;
    const d = deps({
      isInstalled: vi.fn(() => installed),
      install: vi.fn(async (opts: OcrInstallOptions) => {
        // 下载过程中问一次：必须还是 downloading，不能被文件检查改写成 idle
        installed = false;
        const during = await handlers.get("ocr.getInstallState")!(null);
        expect(during).toMatchObject({
          phase: "downloading",
          installed: false,
        });
        opts.onProgress(100);
      }),
    });
    registerOcrIpc(d);
    await handlers.get("ocr.install")!(null);
  });
});
