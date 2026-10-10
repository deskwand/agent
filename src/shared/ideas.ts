/**
 * 想法（随手记）：主进程与渲染层共用的唯一一份形状。
 *
 * 放在 shared 而不是主进程里：正文上限两边都要用（浮层禁用保存按钮 / 主进程最后
 * 一道校验），类型也要跨 IPC 走一遍 —— 各写一份迟早漂移，表现形式是「按钮亮着，
 * 主进程却拒绝」这种最难查的错位。
 */
export type IdeaStatus = "inbox" | "archived";

export interface IdeaSummary {
  name: string;
  excerpt: string;
  createdAt: number;
  status: IdeaStatus;
  archivedAt: number | null;
  sourceSessionId: string | null;
  sourceView: string | null;
}

export interface IdeaList {
  inbox: IdeaSummary[];
  archived: IdeaSummary[];
  skipped: number;
}

/** 一条想法的正文上限，按码点算（与文件名截断同一把尺）。 */
export const MAX_IDEA_BODY_CODE_POINTS = 4000;

/**
 * `ideas.read` 的返回：**正文**（frontmatter 已剥掉）与用于比对基线的 mtime。
 *
 * 这里刻意叫 `body` 而不是 `markdown`：编辑器拿到的必须是正文，否则一次保存就会把
 * frontmatter 写进正文里（实测过：文件每存一次就多嵌一层 frontmatter）。
 */
export interface IdeaReadResult {
  body: string;
  mtimeMs: number;
}

/** `ideas.create` 的入参（渲染层、IPC、主进程三处共用一份）。 */
export interface IdeaCreateInput {
  content: string;
  sourceSessionId?: string | null;
  sourceView?: string | null;
}

/** `ideas.update` 的入参：`mtimeMs` 是防外部改写的那道闸。 */
export interface IdeaUpdatePatch {
  content: string;
  mtimeMs: number;
}

/**
 * `ideas.update` 的返回：多回一个新的 `mtimeMs`。
 *
 * 编辑器保存后要接上下一次比对的基线 —— 不回新值，用户改第二次就必然撞 IDEA_STALE。
 */
export type IdeaUpdateResult = IdeaSummary & { mtimeMs: number };
