import { beforeEach, describe, expect, it, vi } from "vitest";

type ExposedElectronApi = {
  artifact: { getRenderUrl: (filePath: string) => Promise<string | null> };
};

describe("preload artifact API", () => {
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

  it("exposes getRenderUrl", () => {
    expect(typeof exposedApi?.artifact.getRenderUrl).toBe("function");
  });

  it("routes through the artifact:get-render-url channel", async () => {
    await exposedApi?.artifact.getRenderUrl("/w/report.html");
    expect(ipcInvoke).toHaveBeenCalledWith(
      "artifact:get-render-url",
      "/w/report.html",
    );
  });
});
