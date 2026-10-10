import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { getIdeasRoot } from "./paths";
import {
  buildIdeaFileName,
  parseIdeaFile,
  serializeIdeaFile,
  type IdeaRecord,
} from "./idea-markdown";
import {
  MAX_IDEA_BODY_CODE_POINTS,
  type IdeaCreateInput,
  type IdeaList,
  type IdeaReadResult,
  type IdeaStatus,
  type IdeaSummary,
  type IdeaUpdateResult,
} from "../../shared/ideas";

const EXCERPT_CODE_POINTS = 120;

/** 临时文件名里的序号，只增不减（同一个进程内保证唯一）。 */
let tempPathCounter = 0;

/**
 * 与密库 `isUnsupportedScopeSegment` 同一套规则：拒绝对路径、`..`、分隔符、
 * Win32 保留名与尾点尾空格。文件名来自正文，越界不是理论风险。
 */
function assertSafeName(name: string): void {
  const bad =
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    // 控制字符（含换行）：POSIX 允许但 Windows 不允许，而名字来自正文，只可能是调用方出错。
    /\p{Cc}/u.test(name) ||
    name === "." ||
    name === ".." ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name);
  if (bad) throw new Error("IDEA_BAD_NAME");
}

function toExcerpt(body: string): string {
  return Array.from(body.replace(/\s+/g, " ").trim())
    .slice(0, EXCERPT_CODE_POINTS)
    .join("");
}

function toSummary(name: string, record: IdeaRecord): IdeaSummary {
  return {
    name,
    excerpt: toExcerpt(record.body),
    createdAt: record.createdAt,
    status: record.status,
    archivedAt: record.archivedAt,
    sourceSessionId: record.source.session,
    sourceView: record.source.view,
  };
}

function byNewestFirst(a: IdeaSummary, b: IdeaSummary): number {
  return b.createdAt - a.createdAt;
}

function byArchivedNewestFirst(a: IdeaSummary, b: IdeaSummary): number {
  return (b.archivedAt ?? 0) - (a.archivedAt ?? 0);
}

export class IdeaStore {
  constructor(private readonly rootDir: string = getIdeasRoot()) {}

  private filePath(name: string): string {
    assertSafeName(name);
    return join(this.rootDir, `${name}.md`);
  }

  /** 目录按需创建：不在安装时预建一个空目录（它是密库模块，由密库扫描发现）。 */
  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async list(): Promise<IdeaList> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch (error) {
      // 只有"目录还不存在"才等于"没有想法"。EACCES / EIO / 卷没挂上都不能报成空 ——
      // 那会让用户看见"还没有想法"的空态，转头又记一遍重复的。
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { inbox: [], archived: [], skipped: 0 };
      }
      throw error;
    }

    const summaries: IdeaSummary[] = [];
    let skipped = 0;
    for (const entry of entries) {
      // 非 .md 静默忽略；隐藏文件（含 .DS_Store）同理。
      if (!entry.endsWith(".md") || entry.startsWith(".")) continue;
      const name = entry.slice(0, -3);
      try {
        const path = join(this.rootDir, entry);
        const [text, stats] = await Promise.all([
          readFile(path, "utf8"),
          stat(path),
        ]);
        const record = parseIdeaFile(text, stats.mtimeMs);
        if (!record) {
          skipped += 1;
          continue;
        }
        summaries.push(toSummary(name, record));
      } catch {
        skipped += 1;
      }
    }

    return {
      inbox: summaries.filter((s) => s.status === "inbox").sort(byNewestFirst),
      archived: summaries
        .filter((s) => s.status === "archived")
        .sort(byArchivedNewestFirst),
      skipped,
    };
  }

  async read(name: string): Promise<IdeaReadResult> {
    const path = this.filePath(name);
    try {
      // 先读文本再取 mtime（**顺序**，不要 Promise.all）：这样回来的 mtime 不会早于
      // 文本那一版，比对时只会偏向"判为过期"，不会放行一次覆盖。
      const text = await readFile(path, "utf8");
      const stats = await stat(path);
      const record = parseIdeaFile(text, stats.mtimeMs);
      // 编辑的是**正文**：把整份文件交给编辑器，保存一次就会把 frontmatter 嵌进正文。
      // 解析不了（YAML 坏）时退回原文，至少让用户能看见并改回来。
      return { body: record ? record.body : text, mtimeMs: stats.mtimeMs };
    } catch {
      throw new Error("IDEA_NOT_FOUND");
    }
  }

  async create(input: IdeaCreateInput): Promise<IdeaSummary> {
    const content = input.content.trim();
    // 空正文会写出一条摘要是空、名字只有时间戳的"想法"（agent 的 idea_add 能走到这里）。
    if (!content) throw new Error("IDEA_EMPTY");
    if (Array.from(content).length > MAX_IDEA_BODY_CODE_POINTS) {
      throw new Error("IDEA_TOO_LONG");
    }
    await this.ensureRoot();

    const createdAt = Date.now();
    const record: IdeaRecord = {
      status: "inbox",
      createdAt,
      archivedAt: null,
      source: {
        session: input.sourceSessionId ?? null,
        view: input.sourceView ?? null,
      },
      body: content,
    };

    const stem = buildIdeaFileName(content, createdAt);
    let name = stem;
    for (let seq = 2; ; seq += 1) {
      try {
        await this.writeNew(this.filePath(name), serializeIdeaFile(record));
        return toSummary(name, record);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (seq > 99) throw new Error("IDEA_NAME_EXHAUSTED");
        name = `${stem}-${seq}`;
      }
    }
  }

  async update(
    name: string,
    content: string,
    mtimeMs: number,
  ): Promise<IdeaUpdateResult> {
    const trimmed = content.trim();
    if (Array.from(trimmed).length > MAX_IDEA_BODY_CODE_POINTS) {
      throw new Error("IDEA_TOO_LONG");
    }
    const path = this.filePath(name);

    let onDisk: number;
    let text: string;
    try {
      // 顺序读：mtime 必须属于刚读到的那一版文本（见 read 的注释）。
      text = await readFile(path, "utf8");
      onDisk = (await stat(path)).mtimeMs;
    } catch {
      throw new Error("IDEA_NOT_FOUND");
    }
    // 文件在外部被改过（或我们读完之后又被写过）→ 拒绝，绝不静默覆盖。
    if (Math.abs(onDisk - mtimeMs) > 0.001) throw new Error("IDEA_STALE");

    const record = parseIdeaFile(text, onDisk);
    if (!record) throw new Error("IDEA_STALE");

    const next: IdeaRecord = { ...record, body: trimmed };
    await this.writeAtomic(path, serializeIdeaFile(next));
    // 回新 mtime：编辑器要拿它当下一次比对的基线，否则改第二次必然撞 IDEA_STALE。
    const written = await stat(path);
    return { ...toSummary(name, next), mtimeMs: written.mtimeMs };
  }

  /**
   * 归档 / 恢复。
   *
   * 注意这会**重写整个文件**（frontmatter 里那个 `status` 必须落盘）：CRLF 会被规范化
   * 成 LF、手写文件缺的 frontmatter 会被补上。这是有意的 —— 归档是用户明确的写操作，
   * §4.3 的"不回写"约束的是**读**路径（列一眼想法不该改用户的文件）。别把这里"修"成
   * 只改一行，那要引入一套行级替换，收益不抵复杂度。
   */
  async setStatus(name: string, status: IdeaStatus): Promise<IdeaSummary> {
    const path = this.filePath(name);
    let record: IdeaRecord;
    try {
      const [text, stats] = await Promise.all([
        readFile(path, "utf8"),
        stat(path),
      ]);
      const parsed = parseIdeaFile(text, stats.mtimeMs);
      if (!parsed) throw new Error("IDEA_NOT_FOUND");
      record = parsed;
    } catch {
      throw new Error("IDEA_NOT_FOUND");
    }

    const next: IdeaRecord = {
      ...record,
      status,
      archivedAt: status === "archived" ? Date.now() : null,
    };
    await this.writeAtomic(path, serializeIdeaFile(next));
    return toSummary(name, next);
  }

  async remove(name: string): Promise<void> {
    const path = this.filePath(name);
    try {
      await unlink(path);
    } catch {
      throw new Error("IDEA_NOT_FOUND");
    }
  }

  /** 临时文件写完后 rename：写到一半断电不能留下半截 md（密库 local-store 同法）。 */
  private async writeAtomic(path: string, content: string): Promise<void> {
    const tempPath = this.tempPathFor(path);
    try {
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, path);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 新建一个文件，且**要求路径原本不存在**（EEXIST 由调用方拿去换名字）。
   *
   * 先写临时文件再 `link`：`link` 对已存在的目标会失败，所以既有"不覆盖"的保证，
   * 又不必先把半截内容暴露在最终路径上。硬链接在个别文件系统上不支持（exFAT 等），
   * 那种情况下退回直接写（`wx`），行为与以前一致。
   */
  private async writeNew(path: string, content: string): Promise<void> {
    const tempPath = this.tempPathFor(path);
    try {
      await writeFile(tempPath, content, "utf8");
      try {
        await link(tempPath, path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          code === "EPERM" ||
          code === "ENOTSUP" ||
          code === "EXDEV" ||
          code === "EMLINK"
        ) {
          await writeFile(path, content, { encoding: "utf8", flag: "wx" });
          return;
        }
        throw error;
      }
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  /** 临时文件名必须唯一：同一个想法的两次并发写不能共用同一个临时文件。 */
  private tempPathFor(path: string): string {
    tempPathCounter += 1;
    return `${path}.${process.pid}.${tempPathCounter}.tmp`;
  }
}
