/**
 * @module shared/ask-user
 *
 * `ask_user` 工具的共享类型与常量：主进程（工具/会话管理）、渲染层（卡片）
 * 与测试共用。运行时校验在 ask-user-tools.ts 的 execute 内（defineTool 不做
 * schema 校验，参照 shared/todos.ts 的先例）。
 */

/** 单题类型：单选 / 多选 / 自由输入 / 是否 */
export type AskUserQuestionType = "choice" | "multiSelect" | "text" | "yesno";

export interface AskUserQuestionOption {
  /** 选项展示文本（也是回传给模型的值；"其他…"自由输入时为用户输入的文本） */
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  /** 完整问题文本（≤500 字符，execute 校验） */
  question: string;
  /** ≤12 字符短标签（卡片上的 tag） */
  header: string;
  /** 缺省按 "choice" 处理（execute 内归一化，不依赖 TypeBox default） */
  type?: AskUserQuestionType;
  /** choice/multiSelect 必填 2–4 个；text/yesno 禁止 */
  options?: AskUserQuestionOption[];
  /** 仅 text 题：输入框 placeholder（≤100 字符） */
  placeholder?: string;
}

/** 按题目索引回传：choice/yesno 为 string，multiSelect 为 string[] */
export type AskUserAnswers = Record<string, string | string[]>;

/** 用户跳过某题的哨兵值；选项 label 不允许取该值 */
export const ASK_USER_SKIPPED = "__SKIPPED__";

export type AskUserResult =
  | { status: "answered"; answers: AskUserAnswers }
  | { status: "cancelled" };

/** 题目列表别名：供不便引用题目类型全名的模块（agent-runner 有字面量守卫测试）使用 */
export type AskUserPromptList = AskUserQuestion[];
