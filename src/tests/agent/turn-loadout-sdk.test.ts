import { describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import {
  createAgentSession,
  defineTool,
  type ToolExposure,
} from "@earendil-works/pi-coding-agent";
import { applySessionTurnPolicyToSdk } from "../../main/agent/agent-runner";
import type { Session } from "../../renderer/types";

/**
 * 真会话回归：把「每轮策略」跑在一个**真的** pi 会话上。
 *
 * 为什么需要它：`sdk-session-policy.test.ts` 用的是假 SDK，`setActiveToolsByName` 是
 * `vi.fn`，它证明不了 SDK 的替换语义与 `getAllTools()` 的 exposure 计算合起来会发生什么。
 * 而 2026-10-10 那次线上事故（每个普通轮把扩展注册的工具与 SDK 基础工具摘掉，模型拿到
 * 「Tool X not found」）恰恰是两个真组件交互的产物 —— 这里把它钉死。
 *
 * 只造桩工具，不依赖 pi-subagents / MCP：四个子代理工具的名字与 exposure 才是契约。
 */

const DIRECT_STUBS = [
  // DeskBand 自己的 direct 工具
  "web_search",
  "fetch_content",
  "get_search_content",
  "todo_write",
  "ask_user",
  // pi-subagents 扩展注册的四个（事故里被摘掉的受害者）
  "Agent",
  "SubagentWorkflow",
  "get_subagent_result",
  "steer_subagent",
];

const VOICE_ONLY_STUBS = ["set_voice"];

const CODEMODE_STUBS = [
  // A1 降级组：声明里不能出现，但必须仍可调用
  "internal_browser_click",
  "office_read_xlsx",
  "vision_describe",
  "ocr",
  "tts",
];

function stub(name: string, exposure?: ToolExposure) {
  return defineTool({
    name,
    label: name,
    description: `${name} stub`,
    parameters: Type.Object({}),
    ...(exposure ? { exposure } : {}),
    async execute() {
      return {
        content: [{ type: "text" as const, text: `${name} ran` }],
        details: undefined,
      };
    },
  });
}

const ORDINARY_SESSION: Session = {
  id: "S",
  kind: "ordinary",
  title: "S",
  status: "idle",
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  isProjectMode: false,
  createdAt: 1,
  updatedAt: 1,
};

async function buildSession() {
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    customTools: [
      ...DIRECT_STUBS.map((name) => stub(name)),
      ...VOICE_ONLY_STUBS.map((name) => stub(name)),
      ...CODEMODE_STUBS.map((name) => stub(name, "codemode")),
    ],
  });
  return session;
}

describe("每轮策略 × 真 SDK 会话", () => {
  it("连跑四轮：注册表里的工具一个不掉，降级工具一个不声明，且第二、三、四轮不重写", async () => {
    const session = await buildSession();
    const spy = vi.spyOn(session, "setActiveToolsByName");

    const declarable = session
      .getAllTools()
      .filter(
        (tool) => tool.exposure === "direct" || tool.exposure === "model-only",
      )
      .map((tool) => tool.name);
    const expected = declarable.filter((name) => name !== "set_voice");

    const seen: string[][] = [];
    for (let turn = 0; turn < 4; turn++) {
      applySessionTurnPolicyToSdk(ORDINARY_SESSION, undefined, session);
      seen.push(session.getActiveToolNames());
    }

    // 每一轮的声明集合都一致（第一轮从"建会话时的全量"写起，后面三轮应原样不动）
    for (const [turn, active] of seen.entries()) {
      expect(active, `第 ${turn + 1} 轮的 active 集合`).toEqual(expected);
      for (const name of ["Agent", "SubagentWorkflow", "grep", "find", "ls"]) {
        expect(active, `第 ${turn + 1} 轮缺了 ${name}`).toContain(name);
      }
      for (const name of [...CODEMODE_STUBS, "set_voice"]) {
        expect(active, `第 ${turn + 1} 轮不该声明 ${name}`).not.toContain(name);
      }
    }

    // 降级工具仍可调用（codemode 网关的口子），声明里却没有它们
    const callable = session.getCallableToolNames();
    expect(callable).toContain("internal_browser_click");
    expect(seen[0]).not.toContain("internal_browser_click");

    // 名单没变就不写：四轮只在第一轮（或第零轮的建会话状态）发生一次写入
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);

    await session.dispose?.();
  });
});
