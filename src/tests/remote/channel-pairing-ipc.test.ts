import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("channel pairing IPC registration", () => {
  it("registers the pairing snapshot and live event channels", () => {
    const main = readFileSync(resolve("src/main/index.ts"), "utf8");
    const preload = readFileSync(resolve("src/preload/index.ts"), "utf8");
    const events = readFileSync(resolve("src/renderer/types/index.ts"), "utf8");
    expect(main).toContain('ipcMain.handle("remote.getChannelPairings"');
    expect(preload).toContain('ipcRenderer.invoke("remote.getChannelPairings")');
    expect(events).toContain('type: "remote.channelPairing"');
  });

  // Task 5: App startup — remoteManager.start is called unconditionally;
  // the runtimeChannelMode feature flag no longer exists.

  it("starts remote manager unconditionally", () => {
    const main = readFileSync(resolve("src/main/index.ts"), "utf8");
    expect(main).not.toContain("runtimeChannelMode");
    expect(main).toContain("remoteManager.start()");
  });

  it("preload imports ChannelPairingEvent statically (not inline dynamic import)", () => {
    const preload = readFileSync(resolve("src/preload/index.ts"), "utf8");
    // Must have a static import
    expect(preload).toContain(
      "import type { ChannelPairingEvent } from",
    );
    // Must NOT contain inline import() for ChannelPairingEvent
    expect(preload).not.toMatch(
      /import\(["']\.\.\/shared\/ipc-types["']\)\.ChannelPairingEvent/,
    );
  });

  it("renderer types import ChannelPairingEvent statically (not inline dynamic import)", () => {
    const events = readFileSync(resolve("src/renderer/types/index.ts"), "utf8");
    expect(events).toContain(
      "import type { ChannelPairingEvent } from",
    );
    expect(events).not.toMatch(
      /import\(["']\.\.\/\.\.\/shared\/ipc-types["']\)\.ChannelPairingEvent/,
    );
  });
});
