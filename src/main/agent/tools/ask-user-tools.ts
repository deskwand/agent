/**
 * @module main/agent/tools/ask-user-tools
 *
 * `ask_user` —— 模型向用户发起结构化提问（1–4 题），挂起等待内联卡片作答。
 * 仅主对话可用：子代理工具集在 deskwand-tools-extension.ts 中显式过滤本工具。
 * defineTool 不做 schema 运行时校验（参照 shared/todos.ts 先例），
 * 所有约束在 execute 内校验并返回 "Rejected: ..." 文本。
 * 挂起机制见 session-manager.ts 的 requestAskUser（pending-Map + Promise，
 * 无超时，会话停止/删除时以 cancelled resolve）。
 */
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  ASK_USER_SKIPPED,
  type AskUserQuestion,
  type AskUserAnswers,
  type AskUserResult,
} from "../../../shared/ask-user";

export type RequestAskUserFn = (
  sessionId: string,
  toolCallId: string,
  questions: AskUserQuestion[],
) => Promise<AskUserResult>;

/** 运行时校验上限（与 promptGuidelines 中的约定一致） */
export const MAX_ASK_QUESTIONS = 4;
export const MAX_HEADER_LENGTH = 12;
export const MAX_QUESTION_LENGTH = 500;
export const MAX_LABEL_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_PLACEHOLDER_LENGTH = 100;

function text(body: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: body }],
    details,
  };
}

function validateQuestions(raw: AskUserQuestion[]): string | undefined {
  if (raw.length < 1 || raw.length > MAX_ASK_QUESTIONS) {
    return `Rejected: ask_user accepts 1-${MAX_ASK_QUESTIONS} questions, got ${raw.length}.`;
  }
  for (const [index, q] of raw.entries()) {
    const n = index + 1;
    if (!q.question || q.question.length > MAX_QUESTION_LENGTH) {
      return `Rejected: question ${n} text must be 1-${MAX_QUESTION_LENGTH} characters.`;
    }
    if (!q.header || q.header.length > MAX_HEADER_LENGTH) {
      return `Rejected: question ${n} header must be 1-${MAX_HEADER_LENGTH} characters.`;
    }
    const type = q.type ?? "choice";
    const needsOptions = type === "choice" || type === "multiSelect";
    if (needsOptions) {
      if (!q.options || q.options.length < 2 || q.options.length > 4) {
        return `Rejected: question ${n} of type "${type}" requires 2-4 options.`;
      }
      for (const opt of q.options) {
        if (
          !opt.label ||
          opt.label.length > MAX_LABEL_LENGTH ||
          (opt.description && opt.description.length > MAX_DESCRIPTION_LENGTH)
        ) {
          return `Rejected: question ${n} has an option exceeding length limits.`;
        }
        if (opt.label === ASK_USER_SKIPPED) {
          return `Rejected: question ${n} option label must not be the reserved sentinel "${ASK_USER_SKIPPED}".`;
        }
      }
    } else if (q.options) {
      return `Rejected: question ${n} of type "${type}" must not define options.`;
    }
    if (q.placeholder && type !== "text") {
      return `Rejected: question ${n} placeholder is only allowed for type "text".`;
    }
    if (q.placeholder && q.placeholder.length > MAX_PLACEHOLDER_LENGTH) {
      return `Rejected: question ${n} placeholder must be at most ${MAX_PLACEHOLDER_LENGTH} characters.`;
    }
  }
  return undefined;
}

/** 校验用户答案与题目结构相符；不符返回错误说明（模型可重新提问） */
function validateAnswers(
  questions: AskUserQuestion[],
  answers: AskUserAnswers,
): string | undefined {
  for (const [index, q] of questions.entries()) {
    const value = answers[String(index)];
    const type = q.type ?? "choice";
    if (value === undefined) {
      return `Rejected: missing answer for question ${index + 1}.`;
    }
    // 整卡跳过：任意题型都允许字符串哨兵（渲染层跳过时全题写 ASK_USER_SKIPPED）
    if (value === ASK_USER_SKIPPED) {
      continue;
    }
    if (type === "yesno" && value !== "Yes" && value !== "No") {
      return `Rejected: answer for question ${index + 1} must be "Yes" or "No".`;
    }
    if (type === "multiSelect" && !Array.isArray(value)) {
      return `Rejected: answer for question ${index + 1} must be an array of labels.`;
    }
  }
  return undefined;
}

export function createAskUserTools(
  sessionId: string,
  requestAskUser: RequestAskUserFn,
): ToolDefinition[] {
  const askUser = defineTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user 1-4 structured questions (single choice, multi-select, " +
      "free text, yes/no) and pause until they answer. Use ONLY when a " +
      "decision is genuinely the user's to make and cannot be resolved from " +
      "context or sensible defaults. Never use it to ask 'may I continue?'.",
    promptSnippet:
      "Ask the user structured clarifying questions with ask_user when a " +
      "decision is truly theirs to make; batch only independent questions.",
    promptGuidelines: [
      "Only ask when the decision is genuinely the user's to make and cannot be resolved from context or sensible defaults; never ask 'may I continue?'.",
      "Batch multiple questions (1-4) in one call ONLY when they are independent; if a later question depends on an earlier answer, call ask_user separately for each step.",
      "Do not issue multiple ask_user calls in parallel within the same turn.",
      "Put the recommended option first and append '(Recommended)' to its label.",
      "Users can always switch any choice question to free-text input ('Other'), so options do not need an explicit 'Other' entry.",
    ],
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String(),
          header: Type.String(),
          type: Type.Optional(
            Type.Union([
              Type.Literal("choice"),
              Type.Literal("multiSelect"),
              Type.Literal("text"),
              Type.Literal("yesno"),
            ]),
          ),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String(),
                description: Type.Optional(Type.String()),
              }),
            ),
          ),
          placeholder: Type.Optional(Type.String()),
        }),
      ),
    }),
    async execute(toolCallId, params) {
      const rawQuestions = (
        Array.isArray(params.questions) ? params.questions : []
      ) as AskUserQuestion[];
      const rejection = validateQuestions(rawQuestions);
      if (rejection) return text(rejection);

      // 缺失 type 归一化为 choice（不依赖 TypeBox default）
      const questions: AskUserQuestion[] = rawQuestions.map((q) => ({
        ...q,
        type: q.type ?? "choice",
      }));

      const result = await requestAskUser(sessionId, toolCallId, questions);

      if (result.status === "cancelled") {
        return text(
          "The user cancelled this question (the session was stopped). " +
            "Continue with reasonable defaults, or explain in plain text " +
            "what you need and let the user reply in chat.",
          { askUserStatus: "cancelled" },
        );
      }

      const answerRejection = validateAnswers(questions, result.answers);
      if (answerRejection) return text(answerRejection);

      return text(JSON.stringify({ answers: result.answers }));
    },
  });

  return [askUser];
}
