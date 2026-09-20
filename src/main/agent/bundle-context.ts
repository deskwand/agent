import { app } from "electron";
import * as path from "path";
import type { BundleContext } from "./bundled-paths";

/**
 * 构造 bundled-paths 需要的环境上下文。
 *
 * 单独成模块而不是放进 bundled-paths.ts：那个模块刻意不依赖 Electron
 * （它的单测在纯 Node 环境直接 import），塞进去会当场弄挂那些测试。
 */
export function bundleContext(): BundleContext {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath ?? "",
    projectRoot: path.join(__dirname, "..", ".."),
    platform: process.platform,
    arch: process.arch,
  };
}
