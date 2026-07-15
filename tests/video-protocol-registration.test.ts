import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("video protocol startup registration", () => {
  it("registers privileges before installing the ready-time handler", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/main/index.ts"),
      "utf8",
    );
    expect(source).toContain("registerVideoProtocolScheme();");
    expect(source).toContain("await installVideoProtocol();");
    expect(source.indexOf("registerVideoProtocolScheme();")).toBeLessThan(
      source.indexOf("app\n  .whenReady()"),
    );
  });

  it("only signs media URLs requested by the main renderer", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/main/index.ts"),
      "utf8",
    );
    expect(source).toContain('ipcMain.handle("video.getSourceUrl"');
    expect(source).toContain("event.sender.id !== mainWindow.webContents.id");
    expect(source).toContain("createVideoSourceUrl(filePath)");
  });

  it("allows only the custom scheme and blob URLs as additional media sources", () => {
    const source = readFileSync(resolve(__dirname, "../index.html"), "utf8");
    expect(source).toContain("media-src 'self' blob: deskwand-media:;");
    expect(source).not.toContain("media-src 'self' file:");
  });
});
