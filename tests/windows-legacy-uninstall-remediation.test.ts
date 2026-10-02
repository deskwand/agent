import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("windows legacy uninstall remediation", () => {
  it("uses a custom NSIS include with actionable recovery guidance", () => {
    const builderConfig = fs.readFileSync(
      path.resolve(process.cwd(), "electron-builder.yml"),
      "utf8",
    );
    const installerInclude = fs.readFileSync(
      path.resolve(process.cwd(), "resources/installer.nsh"),
      "utf8",
    );

    expect(builderConfig).toContain("include: installer.nsh");
    expect(installerInclude).toContain("!macro customUnInstallCheck");
    expect(installerInclude).toContain("Deskwand-Legacy-Cleanup.cmd");
    expect(installerInclude).toContain("$LOCALAPPDATA\\Programs\\Deskwand");
  });

  it("closes long-lived resources during quit cleanup", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/index.ts"),
      "utf8",
    );

    expect(source).toContain("closeDatabase();");
    expect(source).toContain("closeLogFile();");
    expect(source).toContain("stopNavServer();");
    expect(source).toContain(
      'await withTimeout(remoteManager.stop(), 5000, "Remote control shutdown");',
    );
    // MCP 传输的生命周期已交还 SDK：它自己在 `session_shutdown` 里
    // `connection.close()`（`extensions/mcp/index.js:812`），而 pi-mcp 的 StdioTransport
    // 用独立进程组，关传输即回收子进程。所以**不应该**再有一份手工关闭 ——
    // 这条断言就是防它被重新加回来的。
    expect(source).not.toContain("closeAllDeskwandMcpTransports");
  });
});
