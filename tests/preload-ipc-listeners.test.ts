import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "../src/renderer/types";

type IpcEventHandler = (event: unknown, data: ServerEvent) => void;
type ExposedElectronApi = {
  on: (callback: (event: ServerEvent) => void) => () => void;
  getVideoSourceUrl: (filePath: string) => Promise<string>;
};

describe("preload electronAPI.on", () => {
  let serverEventHandler: IpcEventHandler | null = null;
  let exposedApi: ExposedElectronApi | undefined;
  let ipcInvoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    serverEventHandler = null;
    exposedApi = undefined;
    ipcInvoke = vi.fn(async () => "deskwand-media://local/signed");
    vi.resetModules();

    vi.doMock("electron", () => {
      const ipcRenderer = {
        on: vi.fn((channel: string, handler: IpcEventHandler) => {
          if (channel === "server-event") {
            serverEventHandler = handler;
          }
        }),
        once: vi.fn(),
        send: vi.fn(),
        sendSync: vi.fn(() => null),
        invoke: ipcInvoke,
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(
          (channel: string, handler: IpcEventHandler | null) => {
            if (channel === "server-event" && serverEventHandler === handler) {
              serverEventHandler = null;
            }
          },
        ),
      };

      return {
        contextBridge: {
          exposeInMainWorld: vi.fn(
            (_name: string, api: ExposedElectronApi) => {
              exposedApi = api;
            },
          ),
        },
        ipcRenderer,
      };
    });

    await import("../src/preload/index");
  });

  it("requests a signed video source from the main process", async () => {
    await expect(exposedApi?.getVideoSourceUrl("/tmp/clip.mp4")).resolves.toBe(
      "deskwand-media://local/signed",
    );
    expect(ipcInvoke).toHaveBeenCalledWith(
      "video.getSourceUrl",
      "/tmp/clip.mp4",
    );
  });

  it("keeps remaining subscribers active after another subscriber unsubscribes", () => {
    const eventsA: ServerEvent[] = [];
    const eventsB: ServerEvent[] = [];

    const unsubscribeA = exposedApi?.on((event) => eventsA.push(event));
    const unsubscribeB = exposedApi?.on((event) => eventsB.push(event));

    expect(serverEventHandler).toBeTypeOf("function");

    unsubscribeB?.();

    const payload = {
      type: "session.status",
      payload: { sessionId: "s1", status: "idle" as const },
    } satisfies ServerEvent;
    serverEventHandler?.({}, payload);

    expect(eventsA).toEqual([payload]);
    expect(eventsB).toEqual([]);

    unsubscribeA?.();
    expect(serverEventHandler).toBeNull();
  });
});
