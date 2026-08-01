import * as fs from "node:fs";
import { join } from "node:path";

/**
 * 解析 pi-coding-agent 包目录。
 * vite 打包后 __dirname 指向 dist-electron/main，SDK 的 getPackageDir()
 * 向上找 package.json 会解析到宿主应用自身（→ 主题路径错误 → initTheme 崩溃）。
 * SDK 官方支持 PI_PACKAGE_DIR 环境变量覆盖包目录解析。
 */
export function resolvePiSdkPackageDir(appPath: string): string | null {
  const candidate = join(
    appPath,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  if (fs.existsSync(join(candidate, "package.json"))) {
    return candidate;
  }
  return null;
}

/** 应用修复：设置 PI_PACKAGE_DIR（幂等，尊重用户显式覆盖）。 */
export function applyPiPackageDirFix(appPath: string): boolean {
  if (process.env.PI_PACKAGE_DIR) {
    return true; // 用户已显式覆盖，保持
  }
  const dir = resolvePiSdkPackageDir(appPath);
  if (dir) {
    process.env.PI_PACKAGE_DIR = dir;
    return true;
  }
  return false;
}
