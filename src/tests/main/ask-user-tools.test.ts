import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createAskUserTools,
  type RequestAskUserFn,
} from "../../main/agent/tools/ask-user-tools";
import type { AskUserQuestion, AskUserResult } from "../../shared/ask-user";

const validQuestions: AskUserQuestion[] = [
  {
    question: "数据库用哪个？",
    header: "技术栈",
    type: "choice",
    options: [{ label: "PostgreSQL" }, { label: "SQLite" }],
  },
  {
    question: "要哪些模块？",
    header: "范围",
    type: "multiSelect",
    options: [{ label: "登录" }, { label: "测试" }],
  },
];

/** 每个用例独立创建工具，requestAskUser 可控 resolve */
function setup() {
  let resolveFn!: (r: AskUserResult) => void;
  const requestAskUser = vi.fn<RequestAskUserFn>(
    (_sessionId, _toolCallId, _qs) =>
      new Promise<AskUserResult>((resolve) => {
        resolveFn = resolve;
      }),
  );
  const tools = createAskUserTools("s-1", requestAskUser);
  return { tool: tools[0]!, requestAskUser, resolveFn: () => resolveFn };
}

interface ExecResult {
  content: Array<{ type: string; text: string }>;
  details?: Record<string, unknown>;
}

function textOf(result: unknown): string {
  return (result as ExecResult).content[0]!.text;
}

/** SDK 的 execute 需要 5 个参数（signal/onUpdate/ctx）；测试只关心前两个 */
function run(tool: ToolDefinition, params: object) {
  return tool.execute("t-1", params, undefined, undefined, undefined as never);
}

describe("ask_user tool", () => {
  it("0 题被运行时校验拒绝", async () => {
    const { tool } = setup();
    const result = await run(tool, { questions: [] });
    expect(textOf(result)).toMatch(/^Rejected/);
  });

  it("5 题被运行时校验拒绝", async () => {
    const { tool } = setup();
    const result = await run(tool, {
      questions: Array.from({ length: 5 }, (_, i) => ({
        question: `q${i}`,
        header: `h${i}`,
        type: "text" as const,
      })),
    });
    expect(textOf(result)).toMatch(/^Rejected/);
  });

  it("header 超 12 字符被拒绝", async () => {
    const { tool } = setup();
    const result = await run(tool, {
      questions: [{ question: "q", header: "超长标签超过十二个字符了吧" }],
    });
    expect(textOf(result)).toMatch(/^Rejected: question 1 header/);
  });

  it("choice 缺 options 被拒绝", async () => {
    const { tool } = setup();
    const result = await run(tool, {
      questions: [{ question: "q", header: "h", type: "choice" }],
    });
    expect(textOf(result)).toMatch(/^Rejected: question 1/);
  });

  it("text 题带 options 被拒绝", async () => {
    const { tool } = setup();
    const result = await run(tool, {
      questions: [
        {
          question: "q",
          header: "h",
          type: "text",
          options: [{ label: "a" }, { label: "b" }],
        },
      ],
    });
    expect(textOf(result)).toMatch(/^Rejected: question 1/);
  });

  it("缺失 type 归一化为 choice 并放行", async () => {
    const { tool, requestAskUser, resolveFn } = setup();
    const pending = run(tool, {
      questions: [
        {
          question: "q",
          header: "h",
          options: [{ label: "a" }, { label: "b" }],
        },
      ],
    });
    expect(requestAskUser).toHaveBeenCalledWith("s-1", "t-1", [
      expect.objectContaining({ type: "choice" }),
    ]);
    resolveFn()({ status: "answered", answers: { "0": "a" } });
    const result = (await pending) as ExecResult;
    expect(JSON.parse(textOf(result))).toEqual({ answers: { "0": "a" } });
    expect(result.details).toBeUndefined();
  });

  it("yesno 收到非法值时返回 Rejected（模型可重新提问）", async () => {
    const { tool, resolveFn } = setup();
    const pending = run(tool, {
      questions: [{ question: "部署吗？", header: "部署", type: "yesno" }],
    });
    resolveFn()({ status: "answered", answers: { "0": "maybe" } });
    const result = await pending;
    expect(textOf(result)).toMatch(/^Rejected/);
  });

  it("挂起等待并以 answers JSON 返回", async () => {
    const { tool, resolveFn } = setup();
    const pending = run(tool, { questions: validQuestions });
    resolveFn()({
      status: "answered",
      answers: { "0": "PostgreSQL", "1": ["测试"] },
    });
    const result = await pending;
    expect(JSON.parse(textOf(result))).toEqual({
      answers: { "0": "PostgreSQL", "1": ["测试"] },
    });
  });

  it("取消时返回引导文案并带 askUserStatus details", async () => {
    const { tool, resolveFn } = setup();
    const pending = run(tool, { questions: validQuestions });
    resolveFn()({ status: "cancelled" });
    const result = (await pending) as ExecResult;
    expect(textOf(result)).toMatch(/cancelled/i);
    expect(result.details).toEqual({ askUserStatus: "cancelled" });
  });

  it("整卡跳过：全题哨兵值（含 multiSelect）原样返回", async () => {
    const { tool, resolveFn } = setup();
    const pending = run(tool, { questions: validQuestions });
    resolveFn()({
      status: "answered",
      answers: { "0": "__SKIPPED__", "1": "__SKIPPED__" },
    });
    const result = await pending;
    expect(JSON.parse(textOf(result))).toEqual({
      answers: { "0": "__SKIPPED__", "1": "__SKIPPED__" },
    });
  });

  it("选项 label 为哨兵值被拒绝", async () => {
    const { tool } = setup();
    const result = await run(tool, {
      questions: [
        {
          question: "q",
          header: "h",
          type: "choice",
          options: [{ label: "__SKIPPED__" }, { label: "b" }],
        },
      ],
    });
    expect(textOf(result)).toMatch(/^Rejected: question 1/);
  });

  it("非 text 题带 placeholder 被拒绝", async () => {
    const { tool } = setup();
    const result = await run(tool, {
      questions: [
        { question: "q", header: "h", type: "yesno", placeholder: "hint" },
      ],
    });
    expect(textOf(result)).toMatch(/^Rejected: question 1/);
  });

  it("questions 非数组时拒绝而非抛错", async () => {
    const { tool } = setup();
    for (const bad of [{}, "ab", null]) {
      const result = (await run(tool, {
        questions: bad as unknown as AskUserQuestion[],
      })) as ExecResult;
      expect(textOf(result)).toMatch(/^Rejected/);
      expect((result as { details?: unknown }).details).toBeUndefined();
    }
  });
});
