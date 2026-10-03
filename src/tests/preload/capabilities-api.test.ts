import { beforeEach, describe, expect, it, vi } from "vitest";

type ExposedElectronApi = {
  capabilities: {
    permissions: () => Promise<unknown>;
    openPermissionSettings: (kind: string) => Promise<unknown>;
  };
};

describe("preload capabilities API", () => {
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

  it("exposes both capability methods", () => {
    expect(typeof exposedApi?.capabilities.permissions).toBe("function");
    expect(typeof exposedApi?.capabilities.openPermissionSettings).toBe(
      "function",
    );
  });

  it("invokes the matching channels", async () => {
    await exposedApi!.capabilities.permissions();
    expect(ipcInvoke).toHaveBeenCalledWith("capabilities.permissions");

    await exposedApi!.capabilities.openPermissionSettings("screen-recording");
    expect(ipcInvoke).toHaveBeenCalledWith(
      "capabilities.openPermissionSettings",
      "screen-recording",
    );
  });
});
