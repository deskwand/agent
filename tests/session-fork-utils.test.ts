import { describe, expect, it } from "vitest";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import {
  extractEntryText,
  findAssistantEntryAt,
  piEntryToMessage,
} from "../src/main/session/fork-utils";

const ts = "2026-08-08T10:00:00.000Z";

function msg(overrides: Partial<SessionMessageEntry> = {}): SessionMessageEntry {
  return {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text: "hi" }] },
    ...overrides,
  } as SessionMessageEntry;
}

// 分支里还混着 model_change / thinking_level_change 等其他类型 entry
const branch: SessionEntry[] = [
  { type: "model_change", id: "m1", parentId: null, timestamp: ts, provider: "openai", modelId: "gpt-5.4" },
  msg({ id: "u1", message: { role: "user", content: [{ type: "text", text: "帮我设计登录页" }] } }),
  msg({
    id: "a1",
    parentId: "u1",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "先看下项目结构" },
        { type: "text", text: "好的，方案如下" },
        { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
      ],
    },
  }),
  msg({ id: "tr1", parentId: "a1", message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "src\npackage.json" }] } }),
  msg({ id: "u2", parentId: "a1", message: { role: "user", content: [{ type: "text", text: "改用 OAuth" }] } }),
];

describe("extractEntryText", () => {
  it("拼接 text 块，忽略非 text 块", () => {
    expect(
      extractEntryText([{ type: "thinking", thinking: "x" }, { type: "text", text: "a" }, { type: "text", text: "b" }]),
    ).toBe("a\nb");
  });
  it("非数组返回空串", () => {
    expect(extractEntryText(undefined)).toBe("");
  });
});

describe("findAssistantEntryAt", () => {
  it("跳过 toolResult 与其他类型 entry，按序号取 assistant entry 并校验文本", () => {
    const entry = findAssistantEntryAt(branch, 0, "好的，方案如下");
    expect(entry.id).toBe("a1");
  });
  it("序号对应但��本不一致 → 抛错", () => {
    expect(() => findAssistantEntryAt(branch, 0, "别的文本")).toThrow("无法在会话文件中定位分叉点");
  });
  it("序号越界（branch 中 assistant 不足）→ 抛错", () => {
    expect(() => findAssistantEntryAt(branch, 5, "x")).toThrow("无法在会话文件中定位分叉点");
  });
});

describe("piEntryToMessage", () => {
  it("assistant entry 全保真映射：thinking/text/toolCall → thinking/text/tool_use", () => {
    const m = piEntryToMessage(branch[2], "sess-new", 0);
    expect(m.id).toBe("fork-sess-new-0");
    expect(m.sessionId).toBe("sess-new");
    expect(m.role).toBe("assistant");
    expect(m.turnId).toBe("a1");
    expect(m.timestamp).toBe(Date.parse(ts));
    expect(m.content).toEqual([
      { type: "thinking", thinking: "先看下项目结构" },
      { type: "text", text: "好的，方案如下" },
      { type: "tool_use", id: "call_1", name: "bash", input: { command: "ls" } },
    ]);
  });

  it("toolResult entry → role assistant + 单个 tool_result 块（toolUseId 来自 toolCallId）", () => {
    const m = piEntryToMessage(branch[3], "sess-new", 1);
    expect(m.role).toBe("assistant");
    expect(m.content).toEqual([
      { type: "tool_result", toolUseId: "call_1", content: "src\npackage.json" },
    ]);
  });

  it("user entry 原样映射；图片块兼容 pi-ai 扁平式与 Anthropic source 式", () => {
    const userEntry = msg({
      id: "u3",
      message: {
        role: "user",
        content: [
          { type: "text", text: "看图" },
          { type: "image", data: "AA==", mimeType: "image/png" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BB==" } },
        ],
      },
    });
    const m = piEntryToMessage(userEntry, "sess-new", 2);
    expect(m.role).toBe("user");
    expect(m.content).toEqual([
      { type: "text", text: "看图" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BB==" } },
    ]);
  });

  it("toolResult 中的图片块映射到 tool_result.images", () => {
    const tr = msg({
      id: "tr2",
      message: {
        role: "toolResult",
        toolCallId: "call_2",
        toolName: "bash",
        content: [
          { type: "text", text: "ok" },
          { type: "image", data: "AA==", mimeType: "image/png" },
        ],
      },
    });
    const m = piEntryToMessage(tr, "sess-new", 3);
    expect(m.content).toEqual([
      { type: "tool_result", toolUseId: "call_2", content: "ok", images: [{ data: "AA==", mimeType: "image/png" }] },
    ]);
  });
});
