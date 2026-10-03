/**
 * @module main/speech/installer
 *
 * 运行时与模型的按需安装：下载 → sha256 校验 → 解包 → 落清单。
 *
 * 为什么分成 runtime 与 model 两次安装：运行时只有 8.7~10.8MB（npmmirror，实测
 * 7.6~10.6 MB/s，1 秒下完），模型 128MB。分开装让"想先试试"的用户能只付小头。
 *
 * 目录形状是 sherpa-onnx-node 的加载器决定的：addon-static-import.js 会去
 * `../sherpa-onnx-<platform>-<arch>/sherpa-onnx.node` 找同级原生包，所以两个包
 * 必须同级摆放。见设计文档 §3.3。
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import * as tar from "tar";
import { log } from "../utils/logger";

export const RUNTIME_VERSION = "1.13.8";
export const MODEL_ID = "x-asr-480ms-zh-en-punct-int8";
/** 朗读的模型。目录名跟随上游模型 id。 */
export const TTS_MODEL_ID = "vits-melo-tts-zh_en";

const RUNTIME_URL = (platform: string, arch: string) =>
  `https://registry.npmmirror.com/sherpa-onnx-${platform}-${arch}/-/sherpa-onnx-${platform}-${arch}-${RUNTIME_VERSION}.tgz`;
const RUNTIME_NODE_URL = `https://registry.npmmirror.com/sherpa-onnx-node/-/sherpa-onnx-node-${RUNTIME_VERSION}.tgz`;

export interface VoiceManifest {
  runtimeVersion: string;
  model: string;
  /**
   * 朗读模型 id。**缺字段 = 未装** —— 语音输入已经发布，老用户的 install.json
   * 里没有这个键，所以不能要求它存在，也不需要写迁移。
   */
  ttsModel?: string;
  installedAt: string;
}

export function voiceRoot(userDataPath: string): string {
  return join(userDataPath, "voice");
}

function manifestPath(userDataPath: string): string {
  return join(voiceRoot(userDataPath), "install.json");
}

export function readManifest(userDataPath: string): VoiceManifest | null {
  try {
    return JSON.parse(
      readFileSync(manifestPath(userDataPath), "utf8"),
    ) as VoiceManifest;
  } catch {
    return null;
  }
}

function writeManifest(
  userDataPath: string,
  next: Partial<VoiceManifest>,
): void {
  const current = readManifest(userDataPath) ?? {
    runtimeVersion: "",
    model: "",
    installedAt: new Date().toISOString(),
  };
  mkdirSync(voiceRoot(userDataPath), { recursive: true });
  writeFileSync(
    manifestPath(userDataPath),
    JSON.stringify({ ...current, ...next }, null, 2),
  );
}

export interface InstallOptions {
  userDataPath: string;
  url: string;
  sha256: string;
  /** 已下载字节数 → 触发一次进度回调。 */
  onProgress: (percent: number) => void;
  /** 阶段切换。语音输入不关心，朗读用它把「解包中」显示出来。 */
  onPhase?: (phase: "downloading" | "extracting") => void;
  signal?: AbortSignal;
}

/**
 * 下载到临时文件、校验 sha256、解包到目标目录。校验失败不留任何东西。
 *
 * 导出给朗读用 —— 它就是通用件，两个模型（语音输入 / 朗读）都走它。
 */
export async function downloadAndExtract(
  opts: InstallOptions,
  targetDir: string,
  strip: number,
): Promise<void> {
  const tempFile = join(tmpdir(), `voice-${Date.now()}.tar.gz`);
  try {
    const response = await fetch(opts.url, { signal: opts.signal });
    if (!response.ok || !response.body) {
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    const total = Number(response.headers.get("content-length") ?? 0);
    const hash = createHash("sha256");
    let received = 0;
    opts.onProgress(0);
    opts.onPhase?.("downloading");

    // 一边写盘一边算 hash：128MB 不留在内存里
    // undici 的 response.body 是 DOM 的 ReadableStream，而 node:stream/web 的
    // fromWeb 要的是它自己那套声明 —— 运行时同构，TS 里是两套 lib，所以必须转。
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as WebReadableStream<Uint8Array>,
      ),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          hash.update(chunk);
          received += chunk.length;
          if (total > 0)
            opts.onProgress(Math.min(99, Math.floor((received / total) * 100)));
          yield chunk;
        }
      },
      createWriteStream(tempFile),
    );

    const actual = hash.digest("hex");
    if (actual !== opts.sha256) {
      throw new Error(
        `sha256 mismatch: expected ${opts.sha256}, got ${actual}`,
      );
    }

    mkdirSync(targetDir, { recursive: true });
    opts.onPhase?.("extracting");
    await tar.x({ file: tempFile, cwd: targetDir, strip });
    opts.onProgress(100);
  } finally {
    rmSync(tempFile, { force: true });
  }
}

/** 运行时：两个包必须装成同级目录（加载器靠相对路径找原生包）。 */
export async function installRuntime(
  opts: Omit<InstallOptions, "url" | "sha256"> & {
    platform: string;
    arch: string;
    runtimeSha256: string;
    nodeSha256: string;
  },
): Promise<void> {
  const dir = join(voiceRoot(opts.userDataPath), "runtime", RUNTIME_VERSION);
  const platformPkg = `sherpa-onnx-${opts.platform}-${opts.arch}`;

  // npm tarball 顶层是 package/ → strip 1
  await downloadAndExtract(
    { ...opts, url: RUNTIME_NODE_URL, sha256: opts.nodeSha256 },
    join(dir, "sherpa-onnx-node"),
    1,
  );
  await downloadAndExtract(
    {
      ...opts,
      url: RUNTIME_URL(opts.platform, opts.arch),
      sha256: opts.runtimeSha256,
    },
    join(dir, platformPkg),
    1,
  );
  writeManifest(opts.userDataPath, { runtimeVersion: RUNTIME_VERSION });
  log("[Voice] runtime installed");
}

/**
 * 模型包的顶层**没有**包装目录（我们自己打的包，只含那 5 个必需文件），所以
 * strip 0、解到 `models/<MODEL_ID>/`。**不要把它改成 strip 1** —— 那会把文件
 * 抹平到 `models/` 下，加载器就找不到 bpe.model 了。
 */
export async function installModel(opts: InstallOptions): Promise<void> {
  const dir = join(voiceRoot(opts.userDataPath), "models", MODEL_ID);
  try {
    await downloadAndExtract(opts, dir, 0);
    writeManifest(opts.userDataPath, { model: MODEL_ID });
    log("[Voice] model installed");
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 只删语音输入自己的模型。
 *
 * 改前它删整个 `<userData>/voice/`：朗读接入后那会连朗读的模型和共享运行时
 * 一起抹掉。运行时不提供删除入口 —— 它被两个功能共享，而且只有 23–33MB。
 */
export function removeVoiceModel(userDataPath: string): void {
  rmSync(join(voiceRoot(userDataPath), "models", MODEL_ID), {
    recursive: true,
    force: true,
  });
  writeManifest(userDataPath, { model: "" });
}

/**
 * 朗读模型。包是我们自己打的，顶层没有包装目录 → strip 0（与 installModel 同理）。
 * 失败时把半成品目录删掉：留着半份模型，下次「已安装」会误判。
 */
export async function installTtsModel(opts: InstallOptions): Promise<void> {
  const dir = join(voiceRoot(opts.userDataPath), "models", TTS_MODEL_ID);
  try {
    await downloadAndExtract(opts, dir, 0);
    writeManifest(opts.userDataPath, { ttsModel: TTS_MODEL_ID });
    log("[Tts] model installed");
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export function removeTtsModel(userDataPath: string): void {
  rmSync(join(voiceRoot(userDataPath), "models", TTS_MODEL_ID), {
    recursive: true,
    force: true,
  });
  writeManifest(userDataPath, { ttsModel: "" });
}
