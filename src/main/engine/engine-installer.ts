/**
 * @module main/engine/engine-installer
 *
 * 「最佳音质」档的安装器：预检 → 引擎产物 → 两个 GGUF → 预热。
 *
 * 装到**版本化目录** `~/.deskwand/voice/engines/qwen3-tts/<version>/`，版本目录由
 * 清单里的 `ttsEngine.version`（= 上游 commit）决定。
 *
 * 注意版本目录**只跟引擎产物走，不跟模型坐标走**：引擎不变、只换模型时（如 2026-10-07
 * 的 0.6B → 1.7B），已装用户会被判 `isEngineInstalled() === false` 并重下一次；而
 * `installEngine` 开头就删掉整个版本目录，所以**装失败不会退回旧模型** ——"新版装失败
 * 不影响旧版还能用"那条保证只对换引擎版本成立。见
 * `design-docs/2026-10-07-语音最佳音质档换1.7B-design.md` §5/§6。
 *
 * 失败**整体回滚**：删掉本次版本目录。半装的引擎比没装更糟 —— 它会让
 * `isEngineInstalled()` 说"装了"，然后每次说话都失败。
 */
import { mkdirSync, rmSync, statSync, statfsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import * as os from "node:os";
import { downloadResumable } from "./resume-download";
import { voiceRoot } from "../speech/installer";
import type { TtsEngineSpec } from "../speech/runtime-spec";
import type { EngineBlockedReason } from "../../shared/engine-install";
import { log } from "../utils/logger";

/** 引擎产物 + 两个模型的和，约 1.48GB（非实测值，是三个字节数相加）；留到 3GB 才敢开始。 */
const MIN_FREE_DISK_BYTES = 3 * 1024 * 1024 * 1024;
/**
 * 实测峰值 3841MB（1.7B CustomVoice Q4_K_M + tokenizer Q8_0，M3 Air，跑三句后的稳态）。
 * 16GB 以下的机器跑不动（会换页到卡死）。换 1.7B 前用的是 0.6B，那时是 2737MB。
 */
const MIN_TOTAL_MEM_BYTES = 16 * 1024 * 1024 * 1024;

export function engineRoot(userDataPath: string, version: string): string {
  return join(voiceRoot(userDataPath), "engines", "qwen3-tts", version);
}

/** 可执行文件名按平台。上游在 Windows 上产出 `tts-server.exe`。 */
export function engineBinPath(root: string): string {
  return join(
    root,
    "bin",
    process.platform === "win32" ? "tts-server.exe" : "tts-server",
  );
}

/** 从 URL 取文件名 —— 模型名由清单决定，代码里不硬编码两份。 */
function urlBaseName(url: string): string {
  return basename(new URL(url).pathname);
}

export interface EnginePaths {
  root: string;
  bin: string;
  talker: string;
  tokenizer: string;
}

export function enginePaths(
  userDataPath: string,
  spec: TtsEngineSpec,
): EnginePaths {
  const root = engineRoot(userDataPath, spec.version);
  const models = join(root, "models");
  return {
    root,
    bin: engineBinPath(root),
    talker: join(models, urlBaseName(spec.talkerUrl)),
    tokenizer: join(models, urlBaseName(spec.tokenizerUrl)),
  };
}

/**
 * 三件齐了才算装好。用 `statSync` 而不是"查清单里的标记"：标记是二手事实，
 * 用户手动删了目录它就会说谎。
 */
export function isEngineInstalled(
  userDataPath: string,
  spec: TtsEngineSpec | undefined,
): boolean {
  if (!spec) return false;
  const paths = enginePaths(userDataPath, spec);
  for (const p of [paths.bin, paths.talker, paths.tokenizer]) {
    try {
      if (statSync(p).size === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * 只删**某一个版本**的目录。回滚用它 —— 版本化目录的意义就是"新版装失败不影响
 * 旧版还能用"，回滚顺手删掉所有版本会让这条保证作废（换版本时一次失败就把旧目录
 * 也清掉，用户从 1.5GB 从头再来）。
 */
export function removeEngineVersion(
  userDataPath: string,
  version: string,
): void {
  rmSync(engineRoot(userDataPath, version), { recursive: true, force: true });
}

/** 删掉整个 `qwen3-tts` 目录（所有版本）。**只给显式卸载用。** */
export function removeEngine(userDataPath: string): void {
  rmSync(join(voiceRoot(userDataPath), "engines", "qwen3-tts"), {
    recursive: true,
    force: true,
  });
}

/**
 * 预检：磁盘 / 内存 / 平台。
 *
 * 三个读数都**可注入**：真机上磁盘与内存是环境事实，测试里必须能构造
 * "磁盘不够"与"内存不够"两种分支，否则这两条路只能靠人肉试。
 */
export function preflightEngine(opts: {
  userDataPath: string;
  spec?: TtsEngineSpec;
  platformKey: string;
  totalMem?: () => number;
  freeDisk?: (path: string) => number;
}): { ok: true } | { ok: false; reason: EngineBlockedReason } {
  // 平台：清单里没有这一项就是"这个平台还没发布"（Windows 在 Phase C 之前）
  if (!opts.spec?.artifactUrl[opts.platformKey]) {
    return { ok: false, reason: "platform" };
  }
  const freeDisk =
    opts.freeDisk ??
    ((path: string) => {
      const fs = statfsSync(path);
      return Number(fs.bavail) * Number(fs.bsize);
    });
  try {
    // 不动磁盘：这个函数在设置页每次渲染时都会被问一次（经 blockedReason），
    // 一个"检查"不该顺手建目录。userDataPath 一定存在，量它就够。
    if (freeDisk(opts.userDataPath) < MIN_FREE_DISK_BYTES) {
      return { ok: false, reason: "disk" };
    }
  } catch {
    // 读不到磁盘信息时不拦人：装的过程还会再失败一次，那时报的是真错误
  }
  const totalMem = (opts.totalMem ?? (() => os.totalmem()))();
  if (totalMem < MIN_TOTAL_MEM_BYTES) return { ok: false, reason: "memory" };
  return { ok: true };
}

/** 解包引擎产物 tar.gz 到版本目录（tar 顶层是 `qwentts-server-<commit>-<platform>/`）。 */
async function extractArtifact(tarFile: string, root: string): Promise<void> {
  const tar = await import("tar");
  await tar.x({ file: tarFile, cwd: root, strip: 1 });
}

export async function installEngine(opts: {
  userDataPath: string;
  spec: TtsEngineSpec;
  platformKey: string;
  /** 0-1 的总进度（引擎产物 + 两个 GGUF 一起算）。 */
  onProgress: (percent: number) => void;
  onPhase?: (phase: "checking" | "downloading" | "installing") => void;
  /** 安装收尾的预热（Task B3 传入真实实现）。失败即回滚。 */
  warmup?: () => Promise<void>;
  signal?: AbortSignal;
  /** 注入以便测试预检。 */
  totalMem?: () => number;
  freeDisk?: (path: string) => number;
}): Promise<void> {
  opts.onPhase?.("checking");
  const pre = preflightEngine({
    userDataPath: opts.userDataPath,
    spec: opts.spec,
    platformKey: opts.platformKey,
    totalMem: opts.totalMem,
    freeDisk: opts.freeDisk,
  });
  if (!pre.ok) throw new Error(`engine preflight failed: ${pre.reason}`);

  const paths = enginePaths(opts.userDataPath, opts.spec);
  const artifactUrl = opts.spec.artifactUrl[opts.platformKey];
  const artifactSha = opts.spec.artifactSha256[opts.platformKey] ?? "";
  const artifactBytes = opts.spec.artifactBytes[opts.platformKey] ?? 0;
  // 清单里 sha256 留空 = 这个平台还没上传产物。**不是待办，是安全默认**：
  // 宁可报错也不装一个没校验过的二进制。
  if (!artifactUrl || !artifactSha) {
    throw new Error("engine artifact not published for this platform");
  }

  const total =
    artifactBytes + opts.spec.talkerBytes + opts.spec.tokenizerBytes;
  const weights = {
    artifact: artifactBytes / total,
    talker: opts.spec.talkerBytes / total,
    tokenizer: opts.spec.tokenizerBytes / total,
  };
  let base = 0;
  const report = (percent: number) =>
    opts.onProgress(base + percent * weights.artifact);

  try {
    rmSync(paths.root, { recursive: true, force: true });
    mkdirSync(join(paths.root, "models"), { recursive: true });

    opts.onPhase?.("downloading");
    const tarFile = join(tmpdir(), `qwentts-${Date.now()}.tar.gz`);
    try {
      await downloadResumable({
        url: artifactUrl,
        target: tarFile,
        sha256: artifactSha,
        bytes: artifactBytes,
        onProgress: report,
        signal: opts.signal,
      });
      opts.onPhase?.("installing");
      await extractArtifact(tarFile, paths.root);
    } finally {
      rmSync(tarFile, { force: true });
    }
    // tar 会保留权限位，但从某些归档工具过来的可能没有 —— 补一次，两行的事
    if (process.platform !== "win32") await chmod(paths.bin, 0o755);

    base += weights.artifact;
    const onModels = (percent: number) =>
      opts.onProgress(base + percent * weights.talker);
    await downloadResumable({
      url: opts.spec.talkerUrl,
      target: paths.talker,
      sha256: opts.spec.talkerSha256,
      bytes: opts.spec.talkerBytes,
      onProgress: onModels,
      signal: opts.signal,
    });
    base += weights.talker;
    await downloadResumable({
      url: opts.spec.tokenizerUrl,
      target: paths.tokenizer,
      sha256: opts.spec.tokenizerSha256,
      bytes: opts.spec.tokenizerBytes,
      onProgress: (percent) =>
        opts.onProgress(base + percent * weights.tokenizer),
      signal: opts.signal,
    });

    opts.onPhase?.("installing");
    if (opts.warmup) await opts.warmup();
    opts.onProgress(1);
  } catch (error) {
    log("[TtsEngine] install failed, rolling back", error);
    removeEngineVersion(opts.userDataPath, opts.spec.version);
    throw error;
  }
}
