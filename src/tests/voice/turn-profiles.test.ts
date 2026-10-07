import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendVoiceSection,
  DESKTOP_ONLY_APPEND_MARKERS,
  filterAppendPromptForSessionKind,
  isVoiceSession,
  resolveTurnThinkingLevel,
  VOICE_KEPT_APPEND_MARKERS,
  VOICE_PROMPT_SECTION,
  VOICE_TURN,
} from "../../main/agent/turn-profiles";

describe("voice turn profile", () => {
  it("keeps exactly the three search tools", () => {
    expect(VOICE_TURN.tools).toEqual([
      "web_search",
      "fetch_content",
      "get_search_content",
    ]);
  });

  // 这不是在钉当前值，而是在钉本次精简的意图：read 会把 163 个技能的段落
  // 拽回系统提示词（约 6K token），office_read_* 与 vision_describe 语音里没有出口。
  it("keeps read, office readers and vision out of the voice list", () => {
    for (const name of [
      "read",
      "bash",
      "office_read_docx",
      "office_read_pdf",
      "office_read_pptx",
      "office_read_xlsx",
      "vision_describe",
      "tts",
      "ask_user",
      "todo_write",
    ]) {
      expect(VOICE_TURN.tools).not.toContain(name);
    }
  });

  it("turns thinking off", () => {
    expect(VOICE_TURN.thinkingLevel).toBe("off");
  });

  it("ships a voice_mode section", () => {
    expect(VOICE_PROMPT_SECTION.trim().length).toBeGreaterThan(0);
    expect(VOICE_PROMPT_SECTION).toContain("<voice_mode>");
    expect(VOICE_PROMPT_SECTION).toContain("</voice_mode>");
  });

  // 真机漏点就在这几条：web_search 的结果里带一份 "### Sources" + markdown 链接，模型照抄。
  // 禁令必须点在"来源列表 / 链接 / 出处"三件事上，而且要说清工具给的来源只供自己读。
  // 这三条是**措辞契约**：改语音段正文时请连这三条一起改（不是噪音断言）。
  it("forbids sources lists, citations and links", () => {
    expect(VOICE_PROMPT_SECTION).toContain("sources list");
    expect(VOICE_PROMPT_SECTION).toContain("Never output a link");
    expect(VOICE_PROMPT_SECTION).toContain("for your own reading only");
  });

  // 桌面 tool_behavior 在语音会话被过滤掉，web 工具的路由必须由语音段自己扛。
  // 三个工具都要点名：`get_search_content` 是搜索结果被截断时的唯一出口。
  it("carries the web tool routing the desktop block used to provide", () => {
    for (const name of ["web_search", "fetch_content", "get_search_content"]) {
      expect(VOICE_PROMPT_SECTION).toContain(name);
    }
  });

  // 作废句式已经没有对象（桌面的那几块根本不发了），别再引回来。
  it("no longer references rules that are not sent", () => {
    expect(VOICE_PROMPT_SECTION).not.toContain("rules above do not apply");
  });

  // 名字写错等于工具静默失效（设计 §8 风险表）。注册名有变动时这条先红。
  it("every allowlisted name is a real registered tool name", () => {
    const registered = [
      "read",
      "bash",
      "edit",
      "write",
      "web_search",
      "fetch_content",
      "get_search_content",
      "vision_describe",
      "tts",
      "ask_user",
      "todo_write",
      "office_read_docx",
      "office_read_pdf",
      "office_read_pptx",
      "office_read_xlsx",
    ];
    for (const name of VOICE_TURN.tools) {
      expect(registered).toContain(name);
    }
  });

  // 文字轮必须原样不动。
  it("leaves the prompt untouched on a text turn", () => {
    expect(appendVoiceSection("base", undefined)).toBe("base");
  });
});

describe("AgentRunner wiring", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../main/agent/agent-runner.ts"),
    "utf-8",
  );

  it("takes the turn profile from the new flag, not the old boolean", () => {
    expect(src).toContain("resolveSessionTurnPolicy(");
    expect(src).toContain("applySessionTurnPolicyToSdk(");
    expect(src).not.toContain("resolveActiveTools");
  });

  it("derives the effective thinking level from the profile", () => {
    expect(resolveTurnThinkingLevel(VOICE_TURN, "high")).toBe("off");
    expect(resolveTurnThinkingLevel(undefined, "high")).toBe("high");
  });

  it("registers the turn profile extension once per session", () => {
    expect(src).toContain("createTurnProfileExtension(");
  });

  it("stores the profile on the cached session every turn", () => {
    expect(src).toContain("sessionRecord.turnProfile = profile");
  });

  // 这两行才是本次改动生效的开关：把过滤挂上、把会话类型传给 web 工具。
  // 只断言常量不断言接线的话，把这两行删掉测试也全绿（评审时实测过）。
  it("wires the filter and the spoken flag into the run loop", () => {
    expect(src).toContain(
      "const sessionAppendPrompt = filterAppendPromptForSessionKind(",
    );
    expect(src).toContain("spoken: isVoiceSession(session)");
  });
});

/**
 * 从 agent-runner.ts 里取出 append 区块的字面量（顺序即拼接顺序）。
 * 与 `src/tests/agent/addendum-size.test.ts` 同一套切法 —— 那边按这段源码给固定开销上闸，
 * 这边用它做过滤行为的耦合检查，数组写法一变两边一起红。
 * 注意 `workspaceInfoPrompt` 是变量不是字面量，切不出来，不参与下面的计数。
 */
function appendPromptBlocks(): string[] {
  const source = fs.readFileSync(
    path.join(__dirname, "../../main/agent/agent-runner.ts"),
    "utf-8",
  );
  const start = source.indexOf("const coworkAppendPrompt = [");
  const end = source.indexOf("].filter(", start);
  if (start < 0 || end < 0) throw new Error("coworkAppendPrompt 未找到");
  return [...source.slice(start, end).matchAll(/`([\s\S]*?)`|"([^"]*)"/g)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
}

describe("语音会话不下发桌面区块", () => {
  const blocks = appendPromptBlocks();

  // 过滤是按标记匹配的：块里改个标签名，过滤会静默失效，语音里又会出现 citation 规则。
  it("每个桌面标记都还在真实区块里", () => {
    for (const marker of DESKTOP_ONLY_APPEND_MARKERS) {
      expect(
        blocks.some((block) => block.includes(marker)),
        `标记失配：${marker}`,
      ).toBe(true);
    }
  });

  it("语音会话只留 persona 与 CRITICAL RULES", () => {
    const kept = filterAppendPromptForSessionKind(blocks, "voice");
    expect(kept).toHaveLength(
      blocks.length - DESKTOP_ONLY_APPEND_MARKERS.length,
    );
    for (const marker of DESKTOP_ONLY_APPEND_MARKERS) {
      expect(
        kept.some((block) => block.includes(marker)),
        `语音会话不该有：${marker}`,
      ).toBe(false);
    }
    expect(kept.join("\n\n")).toContain("Default to chat");
  });

  // 新增一块但两边名单都没它 → 它会静默漏进语音（正是本次要修的那类问题）。
  // 这条在有人往 coworkAppendPrompt 里塞块时先红，逼他决定该不该进语音。
  // `workspaceInfoPrompt` 是变量不是字面量，切不出来，也不在这里的分类范围内。
  it("每个区块都恰好被分类一次", () => {
    for (const block of blocks) {
      const isDesktop = DESKTOP_ONLY_APPEND_MARKERS.some((marker) =>
        block.includes(marker),
      );
      const isKept = VOICE_KEPT_APPEND_MARKERS.some((marker) =>
        block.includes(marker),
      );
      expect(
        isDesktop !== isKept,
        `未分类或重复分类的区块：${block.slice(0, 40)}`,
      ).toBe(true);
    }
  });

  // 这份文本在每个请求的头部，改一个字符提示词缓存整体失效（AGENTS.md §5）。
  // 数组相等 → 拼出来的字符串也相等；这里直接钉"上线时发出去的那串"。
  it("文字会话逐字节原样", () => {
    expect(filterAppendPromptForSessionKind(blocks, "ordinary")).toEqual(
      blocks,
    );
    expect(filterAppendPromptForSessionKind(blocks, undefined)).toEqual(blocks);
    expect(
      filterAppendPromptForSessionKind(blocks, "ordinary").join("\n\n"),
    ).toBe(blocks.join("\n\n"));
  });

  it("isVoiceSession 只认 voice", () => {
    expect(isVoiceSession({ kind: "voice" })).toBe(true);
    expect(isVoiceSession({ kind: "ordinary" })).toBe(false);
    expect(isVoiceSession({})).toBe(false);
  });
});
