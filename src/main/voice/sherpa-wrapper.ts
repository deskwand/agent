/**
 * @module main/voice/sherpa-wrapper
 *
 * 加载 sherpa-onnx 的**高层包装器**（`sherpa-onnx.js`）。
 *
 * 与 `local-engine.ts` 的 `loadSherpaAddon` 不是同一个文件：那里直接要
 * `addon.js`（挂在 `createOnlineRecognizer` 等裸函数上），这里要的是它上面
 * 那层包装 —— `Vad` 类由包装器提供，不是 addon 直接给的。两个文件都在同一个
 * 运行时目录里，所以不会多下一份东西。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { SherpaVad } from "./vad-engine";

export interface SherpaWrapper {
  Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVad;
}

export function loadSherpaWrapper(
  runtimeRoot: string,
  version: string,
): SherpaWrapper {
  // 锚点用 process.cwd()：与 loadSherpaAddon 同理，__filename 在 ESM 下不存在、
  // import.meta.url 在 CJS 下不存在，用哪个都会让另一半运行环境抛 ReferenceError。
  const requireFrom = createRequire(join(process.cwd(), "package.json"));
  return requireFrom(
    `${runtimeRoot}/runtime/${version}/sherpa-onnx-node/sherpa-onnx.js`,
  ) as SherpaWrapper;
}
