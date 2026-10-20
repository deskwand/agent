/**
 * @module main/voice/emotion/installer
 *
 * 情感能力的磁盘与安装：下载 → sha256 校验 → 解包 → 落清单。
 *
 * **一个安装单元**：运行时与模型一起装、一起删（单独一半没用）——
 *
 * 模型署名：emotion2vec（Alibaba FunASR），FunASR 模型开源协议 v1.1（保留模型名与来源）。
 * 与 `src/main/ocr/installer.ts` 同一条判断。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { log } from "../../utils/logger";

export const EMOTION_RUNTIME_VERSION = "1.30.0";
export const EMOTION_MODEL_ID = "emotion2vec-plus-base-int8";

export interface EmotionManifest {
  version?: string;
  model?: string;
  installedAt?: string;
}

export function emotionRoot(userDataPath: string): string {
  return join(userDataPath, "emotion");
}

export function runtimeDir(userDataPath: string): string {
  return join(emotionRoot(userDataPath), "runtime", EMOTION_RUNTIME_VERSION);
}

export function modelDir(userDataPath: string): string {
  return join(emotionRoot(userDataPath), "models", EMOTION_MODEL_ID);
}

function manifestPath(userDataPath: string): string {
  return join(emotionRoot(userDataPath), "install.json");
}

export function readEmotionManifest(
  userDataPath: string,
): EmotionManifest | null {
  try {
    return JSON.parse(
      readFileSync(manifestPath(userDataPath), "utf8"),
    ) as EmotionManifest;
  } catch {
    return null;
  }
}

export function writeEmotionManifest(
  userDataPath: string,
  next: Partial<EmotionManifest>,
): void {
  const current = readEmotionManifest(userDataPath) ?? {};
  mkdirSync(emotionRoot(userDataPath), { recursive: true });
  writeFileSync(
    manifestPath(userDataPath),
    JSON.stringify({ ...current, ...next }, null, 2),
  );
}

export function isEmotionInstalled(userDataPath: string): boolean {
  const manifest = readEmotionManifest(userDataPath);
  return (
    manifest?.version === EMOTION_RUNTIME_VERSION &&
    manifest.model === EMOTION_MODEL_ID &&
    existsSync(
      join(runtimeDir(userDataPath), "node_modules", "onnxruntime-node"),
    ) &&
    existsSync(join(modelDir(userDataPath), "emotion2vec.int8.onnx"))
  );
}

/** 删除整个能力目录（运行时与模型一起）。 */
export function removeEmotion(userDataPath: string): void {
  try {
    rmSync(emotionRoot(userDataPath), { recursive: true, force: true });
  } catch (error) {
    log("[Emotion] remove failed:", error);
  }
}

export interface EmotionRuntimeSpec {
  modelUrl: string;
  modelSha256: string;
  /** 键是 `${process.platform}-${process.arch}`，win 平台写 win32（与 speech 那份同形）。 */
  runtimeUrl: Record<string, string>;
  runtimeSha256: Record<string, string>;
}

/** 打包后 resources/ 是 extraResources 的根；开发时在仓库根（与 speech 的 runtime-spec 同锚点）。 */
export function readEmotionRuntimeSpec(): EmotionRuntimeSpec {
  const path = app.isPackaged
    ? join(process.resourcesPath, "emotion-runtime.json")
    : join(app.getAppPath(), "resources", "emotion-runtime.json");
  return JSON.parse(readFileSync(path, "utf8")) as EmotionRuntimeSpec;
}
