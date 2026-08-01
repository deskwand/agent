import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  applyPiPackageDirFix,
  resolvePiSdkPackageDir,
} from "../../main/extensions/pi-sdk-path";

/**
 * 回归测试：vite 打包后 __dirname 指向 dist-electron/main，
 * SDK getPackageDir() 会解析到宿主 package.json → 主题路径错误 → initTheme 崩溃。
 * 修复：main 进程早期设置 PI_PACKAGE_DIR 指向真实 SDK 包。
 */
describe("pi theme init with PI_PACKAGE_DIR", () => {
  const originalEnv = process.env.PI_PACKAGE_DIR;
  // 定位 SDK 包的真实路径：从测试文件向上找 node_modules/@earendil-works/pi-coding-agent
  const sdkPkgDir = (() => {
    let dir = path.resolve(__dirname, "..", "..", "..");
    while (dir !== path.dirname(dir)) {
      const candidate = path.join(
        dir,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
      );
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
      dir = path.dirname(dir);
    }
    throw new Error("pi-coding-agent package not found");
  })();
  const appRoot = path.resolve(__dirname, "..", "..", ".."); // 项目根

  beforeAll(() => {
    process.env.PI_PACKAGE_DIR = sdkPkgDir;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.PI_PACKAGE_DIR;
    } else {
      process.env.PI_PACKAGE_DIR = originalEnv;
    }
  });

  it("simulates the bundled-build bug: getPackageDir from dist-electron walks up to the host package.json", () => {
    // 复制 SDK getPackageDir() 逻辑，从打包产物目录向上找 package.json
    const bundledDir = path.join(appRoot, "dist-electron", "main");
    let dir = bundledDir;
    let found: string | null = null;
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "package.json"))) {
        found = dir;
        break;
      }
      dir = path.dirname(dir);
    }
    // 打包环境会解析到 DeskWand 自身（而非 SDK 包）
    expect(found).toBe(appRoot);
    // 且该解析下主题目录不存在（崩溃前提）
    expect(
      fs.existsSync(
        path.join(appRoot, "src", "modes", "interactive", "theme", "dark.json"),
      ),
    ).toBe(false);
  });

  it("resolvePiSdkPackageDir finds the real SDK package under the app path", () => {
    const resolved = resolvePiSdkPackageDir(appRoot);
    expect(resolved).toBe(sdkPkgDir);
    expect(
      fs.existsSync(path.join(resolved as string, "dist", "modes", "interactive", "theme", "dark.json")),
    ).toBe(true);
  });

  it("applyPiPackageDirFix sets PI_PACKAGE_DIR and preserves user overrides", () => {
    delete process.env.PI_PACKAGE_DIR;
    expect(applyPiPackageDirFix(appRoot)).toBe(true);
    expect(process.env.PI_PACKAGE_DIR).toBe(sdkPkgDir);
    // 用户显式覆盖时不改动
    process.env.PI_PACKAGE_DIR = "/custom/override";
    expect(applyPiPackageDirFix(appRoot)).toBe(true);
    expect(process.env.PI_PACKAGE_DIR).toBe("/custom/override");
    // 恢复（避免污染后续测试）
    process.env.PI_PACKAGE_DIR = sdkPkgDir;
  });

  it("initTheme loads dark theme and TuiModalManager constructs", async () => {
    const { initTheme } = await import("@earendil-works/pi-coding-agent");
    expect(() => initTheme("dark")).not.toThrow();
    const { TuiModalManager } = await import(
      "../../main/extensions/ui/tui-modal-manager"
    );
    const manager = new TuiModalManager({
      onOpen: () => {},
      onClose: () => {},
      onFrame: () => {},
      onWidgets: () => {},
      onTitleChange: () => {},
    });
    expect(manager).toBeInstanceOf(TuiModalManager);
    manager.dispose();
  });
});
