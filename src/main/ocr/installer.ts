/**
 * @module main/ocr/installer
 *
 * OCR 能力的磁盘与安装：下载 → sha256 校验 → 解包 → 落清单。
 *
 * **一个安装单元**：运行时与模型一起装、一起删。语音那边分两个单元是因为 ASR 与 TTS
 * 各自独立启用、运行时单独有用；OCR 的运行时单独没用，拆开只会多一个「装了运行时但没装
 * 模型」的中间态。见设计 §5.4。
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
import { downloadAndExtract } from "../speech/installer";
import { log } from "../utils/logger";

/**
 * onnxruntime-node 的版本。**必须等于 spike 记录的解析值**：`^1.23.2` 实际解析到 1.30.0
 * 那个量级，不是 1.23.2。改名时 resources/ocr-runtime.json 里的文件名与它一起改。
 */
export const RUNTIME_VERSION = "1.30.0";
export const MODEL_ID = "ppocrv6-small";
/** 模型包内的文件。少一个就当没装。 */
export const MODEL_FILES = [
  "det.onnx",
  "rec.onnx",
  "ppocrv6_dict.txt",
] as const;

export interface OcrManifest {
  version?: string;
  model?: string;
  /** 只给排查用（支持时看安装时间）。没有代码消费者，与语音的清单同形所以保留。 */
  installedAt?: string;
}

export interface OcrRuntimeSpec {
  modelUrl: string;
  modelSha256: string;
  /** 键是 `${platform}-${arch}`，与 runtimeKey() 同形。 */
  runtimeUrl: Record<string, string>;
  runtimeSha256: Record<string, string>;
}

export function ocrRoot(userDataPath: string): string {
  return join(userDataPath, "ocr");
}

export function runtimeDir(userDataPath: string): string {
  return join(ocrRoot(userDataPath), "runtime", RUNTIME_VERSION);
}

export function modelDir(userDataPath: string): string {
  return join(ocrRoot(userDataPath), "models", MODEL_ID);
}

function manifestPath(userDataPath: string): string {
  return join(ocrRoot(userDataPath), "install.json");
}

export function readManifest(userDataPath: string): OcrManifest | null {
  try {
    return JSON.parse(
      readFileSync(manifestPath(userDataPath), "utf8"),
    ) as OcrManifest;
  } catch {
    return null;
  }
}

function writeManifest(userDataPath: string, next: Partial<OcrManifest>): void {
  const current = readManifest(userDataPath) ?? {};
  mkdirSync(ocrRoot(userDataPath), { recursive: true });
  // undefined 的键在 JSON.stringify 里自然消失，所以「删字段」也走这个函数
  writeFileSync(
    manifestPath(userDataPath),
    JSON.stringify({ ...current, ...next }, null, 2),
  );
}

/** 打包后 resources/ 是 extraResources 的根；开发时在仓库根。与语音同一套锚点。 */
export function readSpec(): OcrRuntimeSpec {
  const path = app.isPackaged
    ? join(process.resourcesPath, "ocr-runtime.json")
    : join(app.getAppPath(), "resources", "ocr-runtime.json");
  return JSON.parse(readFileSync(path, "utf8")) as OcrRuntimeSpec;
}

export function runtimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

/** 清单说装了、且文件真的都在，才算装好。用户手工删过目录时不能报「已装」。 */
export function isInstalled(userDataPath: string): boolean {
  const manifest = readManifest(userDataPath);
  if (manifest?.version !== RUNTIME_VERSION || manifest?.model !== MODEL_ID)
    return false;
  const entry = join(
    runtimeDir(userDataPath),
    "node_modules",
    "ppu-paddle-ocr",
    "index.js",
  );
  if (!existsSync(entry)) return false;
  return MODEL_FILES.every((file) =>
    existsSync(join(modelDir(userDataPath), file)),
  );
}

export interface OcrInstallOptions {
  userDataPath: string;
  runtimeUrl: string;
  runtimeSha256: string;
  modelUrl: string;
  modelSha256: string;
  onProgress: (percent: number) => void;
  onPhase: (phase: "downloading" | "extracting") => void;
  signal?: AbortSignal;
  /** 注入以便测试。默认 downloadAndExtract。 */
  extract?: typeof downloadAndExtract;
}

/** 两个包解包都用 strip 0：两个 tarball 都是我们自己打的，顶级就是内容。 */
export async function installOcr(opts: OcrInstallOptions): Promise<void> {
  const extract = opts.extract ?? downloadAndExtract;
  const runtime = runtimeDir(opts.userDataPath);
  const models = modelDir(opts.userDataPath);
  const common = {
    userDataPath: opts.userDataPath,
    onPhase: opts.onPhase,
    signal: opts.signal,
  } as const;

  try {
    // 一条进度条：运行时按体积约占四成，模型六成
    await extract(
      {
        ...common,
        url: opts.runtimeUrl,
        sha256: opts.runtimeSha256,
        onProgress: (percent: number) =>
          opts.onProgress(Math.round(percent * 0.4)),
      },
      runtime,
      0,
    );
    await extract(
      {
        ...common,
        url: opts.modelUrl,
        sha256: opts.modelSha256,
        onProgress: (percent: number) =>
          opts.onProgress(40 + Math.round(percent * 0.6)),
      },
      models,
      0,
    );
    writeManifest(opts.userDataPath, {
      version: RUNTIME_VERSION,
      model: MODEL_ID,
      installedAt: new Date().toISOString(),
    });
    log("[Ocr] installed");
  } catch (error) {
    // 半成品比没有更危险：留着它下一次 isInstalled 会误判。
    // 整个 ocr 目录一起清：它只属于这个能力，而且旧版本的运行时目录也住在这里面。
    rmSync(ocrRoot(opts.userDataPath), { recursive: true, force: true });
    throw error;
  }
}

/**
 * 删掉整个 `ocr/` 目录。
 *
 * 不按 RUNTIME_VERSION 精确删：版本号一升级，老目录就永远留在用户磁盘上（40–80MB），
 * 而「删除」按钮看上去已经把东西删了。清单也不再需要写 —— 目录没了，`isInstalled`
 * 本来就返回 false。
 */
export function removeOcr(userDataPath: string): void {
  rmSync(ocrRoot(userDataPath), { recursive: true, force: true });
  log("[Ocr] removed");
}
