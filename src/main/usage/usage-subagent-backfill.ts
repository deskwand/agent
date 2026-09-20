/**
 * 子代理用量的第二套回填：扫 pi 的子会话根，按 `parentSession` 只认 deskwand 发起的那些。
 *
 * 为什么不用 pi-subagents 的池化上报（`tool_result.usage`）：那个池是全进程共享的，
 * drain 挂在"最先结束的那个被包装工具"上，且只有 token 合计、没有 model —— 归属粒度
 * 和模型两头都拿不到。子会话 JSONL 里每条 assistant 消息都带 provider/model/usage，
 * 是逐条真值。
 *
 * 与主对话回填（usage-backfill.ts）的关系：共用同一套分块让出与指纹思路，但**用自己的
 * 指纹表**（`usage_scan_subagent_files`）。主回填的 `pruneScanRows()` 会把不在它自己
 * 遍历结果里的指纹行删掉，共用一张表会让子代理扫描每轮重读全部文件 —— 指纹短路静默
 * 失效。因为键空间独立，这套扫描首次运行天然全扫，不需要 bump 主回填的解析器版本。
 *
 * **调用频率**：子代理没有实时写入点（池化那条路已删），所以这个 pass 会被每次
 * `usage.query` 调用一次 —— 指纹命中时它只 walk + 读指纹（实测 ~2ms），否则本次运行
 * 新产生的子代理花费要等下次启动才显示。注意：不要把它塞进"每次 app 运行只跑一次"的
 * 缓存里。
 *
 * 目录形状与主对话根不同：`<root>/<projectSlug>/<file>.jsonl`，会话 id 在文件头里，
 * 不能从目录名取。
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { isAbsolute, join, relative, win32 } from "path";
import type { DatabaseSync } from "node:sqlite";
import { logWarn } from "../utils/logger";
import { normalizeTokenUsage } from "./normalize-usage";
import { buildSubagentMessageRecord } from "./usage-records";
import { recordUsage } from "./usage-store";

/**
 * 子代理回填自己的解析器版本。与主回填分开：两边语料与解析逻辑各自演进，
 * 一边修 bug 不该逼另一边全量重扫。
 */
export const SUBAGENT_BACKFILL_PARSER_VERSION = 1;

/** 指纹表名。集中在这里，免得散落的字符串写歪。 */
const SCAN_TABLE = "usage_scan_subagent_files";

/** 与主对话回填同一个行预算：1,000 行 ≈ 16ms，约一帧。按**解析过的非空行**计数。 */
const LINE_BUDGET = 1000;

export interface SubagentBackfillResult {
  /** 解析出用量并尝试入库的消息数。 */
  scanned: number;
  inserted: number;
  /** dedup 命中（同一 entry 已导入过）。 */
  skipped: number;
  /** 有 usage 却缺 entry id 的行：丢掉即漏账，单独计数以便在日志里被发现。 */
  malformed: number;
  filesChanged: number;
  /** 指纹命中、这轮没重读的文件数（主回填里没有这个数）。 */
  filesUnchanged: number;
  /** 根目录读不到（首次启动、或瞬时 EMFILE）：调用方不得把它当"已完成"。 */
  rootUnreadable: boolean;
}

interface SessionHeader {
  id?: unknown;
  parentSession?: unknown;
}

/**
 * 父会话 id = `parentSession` 路径里 deskwand 会话根之后的第一段。
 * 不在该根之内的（别的工具发起的子代理）返回 null，由调用方跳过。
 *
 * `isAbsolute(rel)` 是必需的：不同盘符的 Windows 路径（`D:\...` vs `C:\...`）经
 * `relative()` 后既不以 `..` 开头、也不是 POSIX 绝对路径，会把盘符当成会话 id。
 * 两个 flavor 都判，这样 Windows 语义在任意宿主上都能被单测覆盖。
 */
export function parentSessionIdOf(
  parentSessionPath: string,
  deskwandSessionsRoot: string,
): string | null {
  if (!parentSessionPath) return null;
  const rel = relative(deskwandSessionsRoot, parentSessionPath);
  if (
    !rel ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    win32.isAbsolute(rel)
  ) {
    return null;
  }
  const [sessionId] = rel.split(/[\\/]/);
  return sessionId || null;
}

interface Candidate {
  relPath: string;
  absPath: string;
  mtime: number;
  size: number;
}

function walk(root: string): Candidate[] | null {
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return null;
  }
  const out: Candidate[] = [];
  for (const projectSlug of projectDirs) {
    const projectPath = join(root, projectSlug);
    let names: string[];
    try {
      names = readdirSync(projectPath);
    } catch {
      // 单个目录读不到：跳过它，本轮不记指纹（下轮重试），但不影响其它目录
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const absPath = join(projectPath, name);
      try {
        const stat = statSync(absPath);
        out.push({
          // 指纹表已按来源分表，relPath 不再需要前缀来避碰
          relPath: `${projectSlug}/${name}`,
          absPath,
          mtime: Math.floor(stat.mtimeMs),
          size: stat.size,
        });
      } catch {
        // 指纹缺失只会让下一轮重读一次，不阻塞本轮
      }
    }
  }
  return out;
}

/** 第一行是会话头。用 split 而不是 indexOf("\n")：单行文件没有换行符时后者会切掉末字符。 */
function readHeader(text: string): SessionHeader | null {
  const firstLine = text.split("\n", 1)[0];
  try {
    const parsed = JSON.parse(firstLine) as SessionHeader & { type?: unknown };
    return parsed && parsed.type === "session" ? parsed : null;
  } catch {
    return null;
  }
}

/** 逐文件导入状态，只为让主循环可读。 */
interface FileImportState {
  chunkOpen: boolean;
  linesSinceYield: number;
}

function commitChunk(db: DatabaseSync, state: FileImportState): void {
  if (!state.chunkOpen) return;
  db.exec("COMMIT");
  state.chunkOpen = false;
}

export async function backfillSubagentUsageFromSessions(
  db: DatabaseSync,
  sessionsRoot: string,
  deskwandSessionsRoot: string,
): Promise<SubagentBackfillResult> {
  const result: SubagentBackfillResult = {
    scanned: 0,
    inserted: 0,
    skipped: 0,
    malformed: 0,
    filesChanged: 0,
    filesUnchanged: 0,
    rootUnreadable: false,
  };
  const files = walk(sessionsRoot);
  if (!files) return { ...result, rootUnreadable: true };

  const fingerprint = db.prepare(
    `SELECT mtime, size, parser_version FROM ${SCAN_TABLE} WHERE path = ?`,
  );
  const livePaths = new Set<string>();

  for (const file of files) {
    livePaths.add(file.relPath);
    const stored = fingerprint.get(file.relPath) as unknown as
      | { mtime: number; size: number; parser_version: number }
      | undefined;
    if (
      stored &&
      stored.mtime === file.mtime &&
      stored.size === file.size &&
      stored.parser_version === SUBAGENT_BACKFILL_PARSER_VERSION
    ) {
      result.filesUnchanged += 1;
      continue;
    }
    result.filesChanged += 1;

    let text: string;
    try {
      text = readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }
    const header = readHeader(text);
    const parentSessionId = parentSessionIdOf(
      typeof header?.parentSession === "string" ? header.parentSession : "",
      deskwandSessionsRoot,
    );
    const childSessionId = typeof header?.id === "string" ? header.id : null;
    if (!parentSessionId || !childSessionId) {
      // 不是 deskwand 的子代理：用户的 pi CLI 会话、别处发起的子代理。只记指纹不导入，
      // 免得每轮重读同一批文件。
      markScanned(db, file);
      continue;
    }

    const state: FileImportState = { chunkOpen: false, linesSinceYield: 0 };
    try {
      for (const line of text.split("\n")) {
        if (!line) continue;
        state.linesSinceYield += 1;
        if (!state.chunkOpen) {
          // 一个 chunk 一个事务：不开事务时每行都是一次 fsync（实测同语料 202ms 内存 vs
          // 674-967ms 磁盘），而这条路径首次运行要写三千行。
          db.exec("BEGIN");
          state.chunkOpen = true;
        }
        // 子串是廉价的预筛，真正的判定在 parse 之后（role 必须再确认一次）
        if (line.includes('"role":"assistant"')) {
          importAssistantLine(
            db,
            line,
            parentSessionId,
            childSessionId,
            result,
          );
        }
        if (state.linesSinceYield >= LINE_BUDGET) {
          state.linesSinceYield = 0;
          commitChunk(db, state);
          // 让出事件循环，让主进程喘口气
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      commitChunk(db, state);
    } catch (error) {
      if (state.chunkOpen) db.exec("ROLLBACK");
      // 不写指纹 → 下轮重试；一个坏文件不该让整轮导入失败（这条路径每次查询都会跑）
      logWarn("[Usage] subagent file import failed:", file.relPath, error);
      continue;
    }
    markScanned(db, file);
  }

  pruneScanRows(db, livePaths);
  return result;
}

/** 导入一行；形状不认识时只计数不改账。 */
function importAssistantLine(
  db: DatabaseSync,
  line: string,
  parentSessionId: string,
  childSessionId: string,
  result: SubagentBackfillResult,
): void {
  let entry: { id?: unknown; message?: Record<string, unknown> };
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch {
    return;
  }
  const message = entry.message;
  if (!message || message.role !== "assistant") return;
  const usage = normalizeTokenUsage(
    message.usage,
    typeof message.provider === "string" ? message.provider : undefined,
  );
  if (!usage) return;
  if (typeof entry.id !== "string") {
    // 有花费却没有稳定身份：dedup 键就无从构造，这行只能丢 —— 计数以便日志里能看见
    result.malformed += 1;
    return;
  }
  result.scanned += 1;
  const inserted = recordUsage(
    db,
    buildSubagentMessageRecord(
      parentSessionId,
      childSessionId,
      entry.id,
      message as { timestamp?: unknown; provider?: unknown; model?: unknown },
      usage,
      Date.now(),
    ),
  );
  if (inserted) result.inserted += 1;
  else result.skipped += 1;
}

/** 指纹只描述语料（mtime + size）与解析器版本。 */
function markScanned(db: DatabaseSync, file: Candidate): void {
  db.prepare(
    `INSERT INTO ${SCAN_TABLE} (path, mtime, size, parser_version)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size,
                                     parser_version = excluded.parser_version`,
  ).run(file.relPath, file.mtime, file.size, SUBAGENT_BACKFILL_PARSER_VERSION);
}

/**
 * 删掉自己表里已不存在的文件（用户删了会话目录时）。**只动自己这张表** ——
 * 主回填的 pruneScanRows 没有命名空间过滤，正是因为这一点，两边不能共用一张表。
 */
function pruneScanRows(db: DatabaseSync, livePaths: Set<string>): void {
  const stored = db
    .prepare(`SELECT path FROM ${SCAN_TABLE}`)
    .all() as unknown as Array<{ path: string }>;
  const stale = stored.filter((row) => !livePaths.has(row.path));
  if (stale.length === 0) return;
  const remove = db.prepare(`DELETE FROM ${SCAN_TABLE} WHERE path = ?`);
  db.exec("BEGIN");
  try {
    for (const row of stale) remove.run(row.path);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
