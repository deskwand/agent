import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { IdeaStatus } from "../../shared/ideas";

export interface IdeaSource {
  session: string | null;
  view: string | null;
}

export interface IdeaRecord {
  status: IdeaStatus;
  createdAt: number;
  archivedAt: number | null;
  source: IdeaSource;
  body: string;
}

const FILE_NAME_STEM_CODE_POINTS = 24;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function toCodePoints(value: string): string[] {
  return Array.from(value);
}

function isStatus(value: unknown): value is IdeaStatus {
  return value === "inbox" || value === "archived";
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toSource(value: unknown): IdeaSource {
  if (!value || typeof value !== "object") return { session: null, view: null };
  const raw = value as { session?: unknown; view?: unknown };
  return {
    session:
      typeof raw.session === "string" && raw.session ? raw.session : null,
    view: typeof raw.view === "string" && raw.view ? raw.view : null,
  };
}

/**
 * 解析一个想法文件。
 *
 * **不回写**：没有 frontmatter、字段非法，都只是"读的时候这样理解"，磁盘上的文件
 * 保持用户写下的样子 —— 悄悄改写用户能看见的文件是这里最不该做的事。
 *
 * 返回 null 表示连正文都拿不到（YAML 语法坏），调用方计入 skipped 并跳过这条。
 */
export function parseIdeaFile(
  text: string,
  fallbackMtimeMs: number,
): IdeaRecord | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);

  if (!match) {
    return {
      status: "inbox",
      createdAt: fallbackMtimeMs,
      archivedAt: null,
      source: { session: null, view: null },
      body: normalized.replace(/^\n+/, ""),
    };
  }

  let front: unknown;
  try {
    front = parseYaml(match[1]);
  } catch {
    return null;
  }
  if (front !== null && front !== undefined && typeof front !== "object") {
    return null;
  }

  const raw = (front ?? {}) as Record<string, unknown>;
  const status = isStatus(raw.status) ? raw.status : "inbox";

  // 我们写出去的是 `---\n<yaml>\n---\n\n<body>\n`：分隔空行与末尾换行各剥一层，
  // 让往返严格相等（手写文件多出的空行也在这里被规范化，但只剥一层）。
  let body = normalized.slice(match[0].length);
  if (body.startsWith("\n")) body = body.slice(1);
  if (body.endsWith("\n")) body = body.slice(0, -1);

  return {
    status,
    createdAt: toTimestamp(raw.created) ?? fallbackMtimeMs,
    archivedAt: toTimestamp(raw.archived),
    source: toSource(raw.source),
    body,
  };
}

export function serializeIdeaFile(record: IdeaRecord): string {
  const front = {
    status: record.status,
    created: new Date(record.createdAt).toISOString(),
    archived:
      record.archivedAt === null
        ? null
        : new Date(record.archivedAt).toISOString(),
    source: record.source,
  };
  const yaml = stringifyYaml(front).trimEnd();
  return `---\n${yaml}\n---\n\n${record.body.replace(/\r\n/g, "\n")}\n`;
}

/** Windows 不允许的字符 + 控制字符，统一换成 `-`。 */
const UNSAFE_FILE_CHARS = /[/\\:*?"<>|\p{Cc}]/gu;

function localStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * 文件名（不含 `.md`）。人要在 Finder / Obsidian 里认出它来，所以用时间戳 + 正文
 * 首行，而不是 uuid。截断按**码点**算，避免把 emoji 切成半个字符。
 */
export function buildIdeaFileName(body: string, createdAt: number): string {
  const firstLine = body.split("\n").find((line) => line.trim()) ?? "";
  const stem = toCodePoints(
    firstLine.replace(UNSAFE_FILE_CHARS, "-").replace(/\s+/g, "-"),
  )
    .slice(0, FILE_NAME_STEM_CODE_POINTS)
    .join("")
    .replace(/^[.-]+/, "")
    .replace(/[. ]+$/, "");

  const stamp = localStamp(createdAt);
  return stem ? `${stamp}-${stem}` : stamp;
}
