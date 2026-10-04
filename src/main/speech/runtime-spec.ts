/**
 * @module main/speech/runtime-spec
 *
 * 运行时与模型的下载坐标。文件随包发布，只有 URL 与 sha256，没有二进制。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export interface VoiceRuntimeSpec {
  modelUrl: string;
  modelSha256: string;
  nodeSha256: string;
  /** 键是 `${process.platform}-${process.arch}`，win 平台写 win32。 */
  runtimeSha256: Record<string, string>;
  /** 朗读模型。Task 0 产出。 */
  ttsModelUrl: string;
  ttsModelSha256: string;
  /** 英文音色模型（vits-melo-tts-en）。 */
  ttsEnglishModelUrl: string;
  ttsEnglishModelSha256: string;
}

/** 打包后 resources/ 是 extraResources 的根；开发时在仓库根目录。 */
function specPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "voice-runtime.json")
    : join(app.getAppPath(), "resources", "voice-runtime.json");
}

export function readRuntimeSpec(): VoiceRuntimeSpec {
  return JSON.parse(readFileSync(specPath(), "utf8")) as VoiceRuntimeSpec;
}

export function runtimeKey(): string {
  return `${process.platform}-${process.arch}`;
}
