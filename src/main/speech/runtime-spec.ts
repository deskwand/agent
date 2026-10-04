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
  /**
   * 语音模式的高速音色（matcha-icefall-zh-en + vocos 声码器 + espeak-ng-data）。
   * 一包三件：声码器不在上游 tarball 里，所以由我们打进同一个包。
   */
  ttsFastModelUrl: string;
  ttsFastModelSha256: string;
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

/**
 * 随包发布的模型文件（`resources/` 下的二进制）。
 *
 * 与 `specPath()` 用同一个路径锚点：打包后 `process.resourcesPath` 是
 * extraResources 的根，开发时是仓库根。区别是前者读 JSON 坐标，这里读二进制。
 *
 * 为什么 VAD 模型随包而 ASR/TTS 模型走下载：前者实测 643KB，后者 128MB 起。
 * 几百 KB 换掉一整条「装没装」的状态判断，以及「ASR 装了但 VAD 没装」这个
 * 失败态，划算。
 */
export function readBundledModelPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), "resources", name);
}
