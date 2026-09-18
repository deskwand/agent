import { beforeEach, describe, expect, it, vi } from "vitest";

type ExposedElectronApi = {
  quota: { list: () => Promise<unknown> };
};

describe("preload quota API", () => {
  let exposedApi: ExposedElectronApi | undefined;
  let ipcInvoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    exposedApi = undefined;
    ipcInvoke = vi.fn(async () => null);
    vi.resetModules();

    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInMainWorld: vi.fn((_name: string, api: ExposedElectronApi) => {
          exposedApi = api;
        }),
      },
      ipcRenderer: {
        on: vi.fn(),
        once: vi.fn(),
        send: vi.fn(),
        sendSync: vi.fn(() => null),
        invoke: ipcInvoke,
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
      },
    }));

    await import("../../preload/index");
  });

  it("把 quota.list 暴露到渲染进程并转发到同名 channel（无参数）", async () => {
    expect(typeof exposedApi?.quota?.list).toBe("function");

    await exposedApi?.quota.list();

    expect(ipcInvoke).toHaveBeenCalledWith("quota.list");
  });
});
