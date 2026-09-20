import { execFile } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveBundledBinDir } from "../agent/bundled-paths";
import { bundleContext } from "../agent/bundle-context";

/** 渲染超时。实测最坏（冷启大文档）约 1s，留 5× 余量。 */
const DEFAULT_TIMEOUT_MS = 10_000;

export type OfficePreviewFailure =
  | "binary-missing"
  | "render-failed"
  | "timeout"
  | "empty-output";

export interface OfficePreviewResult {
  ok: boolean;
  /** 渲染产物在磁盘上的**路径**（不是 file:// URL —— 渲染层会自己转换）。 */
  outPath?: string;
  reason?: OfficePreviewFailure;
}

export interface OfficePreviewRunResult {
  code: number;
  stderr: string;
  /** 子进程因超时被杀。用显式 flag 而不是抛异常做控制流。 */
  timedOut?: boolean;
}

export interface OfficePreviewDeps {
  findBinDir?: () => string | null;
  run?: (
    binPath: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<OfficePreviewRunResult>;
  outDir?: string;
  timeoutMs?: number;
}

/**
 * 输出文件名按源路径哈希定名：同一个文档反复预览只占一个文件，天然有界；
 * 因为每次点击都重渲染，不存在陈旧问题。
 */
export function previewOutPath(sourcePath: string, outDir?: string): string {
  const dir = outDir ?? path.join(os.tmpdir(), "deskwand-office-preview");
  const hash = crypto
    .createHash("sha1")
    .update(path.resolve(sourcePath))
    .digest("hex");
  return path.join(dir, `${hash}.html`);
}

function defaultRun(
  binPath: string,
  args: string[],
  timeoutMs: number,
): Promise<OfficePreviewRunResult> {
  return new Promise((resolve) => {
    execFile(
      binPath,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          // 显式注入，而不是指望继承：`enrichProcessPathForBuild()` 里那份
          // OFFICECLI_SKIP_UPDATE 要等**会话启动**才写入 process.env，而用户完全可能
          // 一开应用就去文件面板预览文档。实测（干净 HOME、不带该变量）officecli
          // 会写下 ~/.officecli/config.json（autoUpdate: true）并发起联网更新检查。
          OFFICECLI_SKIP_UPDATE: "1",
          // 每次 `view` 都会留下一个 __resident-serve__ 守护进程（实测：连续预览 3 个
          // 文档 → 3 个进程，PPID 1，RSS 48-60MB，并持有该文档）。它们靠 ~60s 空闲
          // 超时自退，但短时间内预览多个文档会堆起几十到上百 MB。预览是一次性的，
          // 不需要常驻，所以直接关掉。
          OFFICECLI_NO_AUTO_RESIDENT: "1",
        },
      },
      (error, _stdout, stderr) => {
        if (error) {
          // execFile 超时会杀掉子进程并置 killed=true。这一支必须与"普通非零退出"
          // 分开，否则真实超时会被归类成 render-failed —— 让 `timeout` 这个 reason
          // 在生产环境永远不可达。
          resolve({
            code: typeof error.code === "number" ? error.code : 1,
            stderr: String(stderr ?? ""),
            timedOut: Boolean(error.killed),
          });
          return;
        }
        resolve({ code: 0, stderr: String(stderr ?? "") });
      },
    );
  });
}

export async function renderOfficePreview(
  sourcePath: string,
  deps: OfficePreviewDeps = {},
): Promise<OfficePreviewResult> {
  const findBinDir =
    deps.findBinDir ?? (() => resolveBundledBinDir(bundleContext()));
  const run = deps.run ?? defaultRun;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const binDir = findBinDir();
  if (!binDir) return { ok: false, reason: "binary-missing" };

  const binName = process.platform === "win32" ? "officecli.exe" : "officecli";
  const outPath = previewOutPath(sourcePath, deps.outDir);

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // 上一次失败的残留会让 empty-output 判定失真。
    fs.rmSync(outPath, { force: true });
  } catch {
    return { ok: false, reason: "render-failed" };
  }

  let result: OfficePreviewRunResult;
  try {
    result = await run(
      path.join(binDir, binName),
      ["view", sourcePath, "html", "-o", outPath],
      timeoutMs,
    );
  } catch {
    // runner 本身抛错（注入的实现、或 spawn 失败）——按渲染失败处理。
    return { ok: false, reason: "render-failed" };
  }

  if (result.timedOut) return { ok: false, reason: "timeout" };
  if (result.code !== 0) return { ok: false, reason: "render-failed" };

  try {
    if (fs.statSync(outPath).size === 0)
      return { ok: false, reason: "empty-output" };
  } catch {
    return { ok: false, reason: "empty-output" };
  }

  return { ok: true, outPath };
}
