import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ServerEvent } from "../src/renderer/types";

// ── Hoisted mocks (vi.mock factories run before imports) ──
const { mockAutoUpdater, mockLogger, mockFs } = vi.hoisted(() => ({
  mockAutoUpdater: {
    setFeedURL: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
  },
  mockLogger: {
    log: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  },
  mockFs: {
    readFileSync: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: mockAutoUpdater,
}));

vi.mock("../src/main/utils/logger", () => mockLogger);

vi.mock("fs", () => ({
  ...mockFs,
  default: mockFs,
}));

import { initUpdater } from "../src/main/updater";

describe("initUpdater", () => {
  let sendToRenderer: ReturnType<typeof vi.fn>;
  let capturedListeners: Map<string, (...args: any[]) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // checkForUpdatesAndNotify must return a thenable for .catch()
    mockAutoUpdater.checkForUpdatesAndNotify.mockReturnValue(
      Promise.resolve(undefined),
    );

    sendToRenderer = vi.fn();
    capturedListeners = new Map();

    mockAutoUpdater.on.mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        capturedListeners.set(event, handler);
        return mockAutoUpdater;
      },
    );

    initUpdater(sendToRenderer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Configuration ──

  it("sets the feed URL to file.deskwand.com", () => {
    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://file.deskwand.com",
    });
  });

  it("enables autoDownload but disables autoInstallOnAppQuit", () => {
    expect(mockAutoUpdater.autoDownload).toBe(true);
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("calls checkForUpdatesAndNotify on init", () => {
    expect(mockAutoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
  });

  // ── Event Bridge ──

  it("bridges update-available to renderer", () => {
    const handler = capturedListeners.get("update-available");
    expect(handler).toBeDefined();
    handler!({ version: "2.0.0" });
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: "update.available",
      payload: { version: "2.0.0" },
    } as ServerEvent);
  });

  it("bridges update-not-available to renderer", () => {
    const handler = capturedListeners.get("update-not-available");
    expect(handler).toBeDefined();
    handler!();
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: "update.not-available",
      payload: {},
    } as ServerEvent);
  });

  it("bridges download-progress to renderer", () => {
    const handler = capturedListeners.get("download-progress");
    expect(handler).toBeDefined();
    const progress = {
      percent: 45.7,
      bytesPerSecond: 1024000,
      transferred: 51200000,
      total: 112000000,
    };
    handler!(progress);
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: "update.progress",
      payload: progress,
    } as ServerEvent);
  });

  it("bridges update-downloaded to renderer", () => {
    const handler = capturedListeners.get("update-downloaded");
    expect(handler).toBeDefined();
    handler!({ version: "2.0.0" });
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: "update.downloaded",
      payload: { version: "2.0.0" },
    } as ServerEvent);
  });

  it("bridges error to renderer", () => {
    const handler = capturedListeners.get("error");
    expect(handler).toBeDefined();
    handler!(new Error("Network timeout"));
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: "update.error",
      payload: { message: "Network timeout" },
    } as ServerEvent);
  });

  it("registers all 6 expected event listeners", () => {
    const expectedEvents = [
      "checking-for-update",
      "update-available",
      "update-not-available",
      "download-progress",
      "update-downloaded",
      "error",
    ];
    for (const event of expectedEvents) {
      expect(capturedListeners.has(event)).toBe(true);
    }
  });

  it("does NOT use native dialog on update-downloaded", () => {
    // The handler sends to renderer only; no dialog.showMessageBox call
    const handler = capturedListeners.get("update-downloaded");
    handler!({ version: "2.0.0" });
    expect(sendToRenderer).toHaveBeenCalledTimes(1);
  });

  // ── Linux APPIMAGE detection ──

  describe("Linux APPIMAGE detection", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockAutoUpdater.checkForUpdatesAndNotify.mockReturnValue(
        Promise.resolve(undefined),
      );
      mockAutoUpdater.on.mockImplementation(
        (event: string, handler: (...args: any[]) => void) => {
          capturedListeners.set(event, handler);
          return mockAutoUpdater;
        },
      );
    });

    it("sets forceDevUpdateConfig=true when APPIMAGE is already set on Linux", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.APPIMAGE = "/home/user/DeskWand.AppImage";

      try {
        initUpdater(sendToRenderer);
        expect(mockAutoUpdater.forceDevUpdateConfig).toBe(true);
      } finally {
        Object.defineProperty(process, "platform", originalPlatform!);
        delete process.env.APPIMAGE;
      }
    });

    it("sets forceDevUpdateConfig=false when APPIMAGE is missing on Linux and mountinfo detection fails", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      Object.defineProperty(process, "platform", { value: "linux" });
      delete process.env.APPIMAGE; // ensure not set

      // Simulate mountinfo not containing an AppImage
      mockFs.readFileSync.mockReturnValue(
        "1 2 8:1 / / rw - ext4 /dev/sda1 rw",
      );

      try {
        initUpdater(sendToRenderer);
        expect(mockAutoUpdater.forceDevUpdateConfig).toBe(false);
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining("APPIMAGE env is not defined"),
        );
      } finally {
        Object.defineProperty(process, "platform", originalPlatform!);
        delete process.env.APPIMAGE;
      }
    });

    it("recovers APPIMAGE from /proc/self/mountinfo on Linux", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      Object.defineProperty(process, "platform", { value: "linux" });
      delete process.env.APPIMAGE;

      // Simulate a real AppImage mountinfo line
      mockFs.readFileSync.mockReturnValue(
        "100 90 0:45 / /tmp/.mount_DeskWaXYZ rw,relatime - fuse.DeskWand.AppImage /home/user/Downloads/DeskWand-1.2.3.AppImage rw",
      );

      try {
        initUpdater(sendToRenderer);
        expect(process.env.APPIMAGE).toBe(
          "/home/user/Downloads/DeskWand-1.2.3.AppImage",
        );
        expect(mockAutoUpdater.forceDevUpdateConfig).toBe(true);
      } finally {
        Object.defineProperty(process, "platform", originalPlatform!);
        delete process.env.APPIMAGE;
      }
    });

    it("does NOT attempt AppImage detection on non-Linux platforms", () => {
      // process.platform is 'darwin' by default — ensureAppImageEnvOnLinux
      // must short-circuit before touching fs or APPIMAGE
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("should not be called on non-Linux");
      });
      // initUpdater() already called in outer beforeEach on darwin — no throw
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it("handles readFileSync throwing (e.g. container without /proc)", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      Object.defineProperty(process, "platform", { value: "linux" });
      delete process.env.APPIMAGE;

      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      try {
        initUpdater(sendToRenderer);
        expect(mockAutoUpdater.forceDevUpdateConfig).toBe(false);
      } finally {
        Object.defineProperty(process, "platform", originalPlatform!);
        delete process.env.APPIMAGE;
      }
    });
  });
});
