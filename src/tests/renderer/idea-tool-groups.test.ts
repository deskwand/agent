import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import {
  buildToolDisplayBlocks,
  getProcessSummaryFragments,
  type ProcessSummary,
} from "../../renderer/utils/tool-display-blocks";
import { projectNestedToolBlocks } from "../../renderer/utils/nested-tool-display";
import type { ContentBlock } from "../../renderer/types";

/**
 * 降到 codemode 之后，idea 三件套只有两种出现形状：历史会话里的顶层调用，
 * 以及 codemode 的嵌套调用。两种都必须落进「已查阅想法 / 已记录想法」，
 * 而不是通用兜底的「已使用 N 个工具」（AGENTS.md §4）。
 */
const empty: ProcessSummary = {
  readCount: 0,
  todoUpdateCount: 0,
  hasSearch: false,
  hasWebSearch: false,
  hasBrowse: false,
  hasMemory: false,
  commandCount: 0,
  subagentCount: 0,
  hasGoal: false,
  usedToolCount: 0,
};

function firstSummary(blocks: ContentBlock[]): ProcessSummary {
  const first = buildToolDisplayBlocks(blocks)[0];
  if (first?.type !== "process-summary") {
    throw new Error("没有被摘要分组");
  }
  return first.summary;
}

/** 顶层调用：降级前记录的会话就是这种形状。 */
function topLevelSummary(name: string): ProcessSummary {
  return firstSummary([
    { type: "tool_use", id: "t-1", name, input: {} } as ContentBlock,
    { type: "tool_result", toolUseId: "t-1", content: "ok" } as ContentBlock,
  ]);
}

/** 嵌套调用：降级之后实时的形状。 */
function nestedSummary(name: string): ProcessSummary {
  const parentId = "call-1";
  const blocks = [
    { type: "tool_use", id: parentId, name: "codemode", input: {} },
    {
      type: "tool_result",
      toolUseId: parentId,
      content: "ok",
      nestedCalls: {
        parentToolCallId: parentId,
        parentStatus: "ok",
        complete: true,
        source: "final",
        calls: [{ id: "nested-1", name, input: {}, status: "ok" }],
      },
    },
  ] as unknown as ContentBlock[];
  return firstSummary(projectNestedToolBlocks(blocks, {}, false));
}

afterEach(async () => {
  await i18n.changeLanguage("zh");
});

describe("idea 调用的摘要分组", () => {
  it("顶层 idea_search / idea_read 计入「查阅想法」，不再落进通用工具数", () => {
    for (const name of ["idea_search", "idea_read"]) {
      const summary = topLevelSummary(name);
      expect(summary.ideaLookupCount, name).toBe(1);
      expect(summary.usedToolCount, name).toBe(0);
    }
  });

  it("顶层 idea_add 计入「记录想法」", () => {
    const summary = topLevelSummary("idea_add");
    expect(summary.ideaAddedCount).toBe(1);
    expect(summary.usedToolCount).toBe(0);
  });

  it("codemode 里调 idea_search 走同一组", () => {
    const summary = nestedSummary("idea_search");
    expect(summary.ideaLookupCount).toBe(1);
    expect(summary.usedToolCount).toBe(0);
  });

  it("不认识的 idea_* 名字落进通用兜底，且仍被分组", () => {
    const summary = topLevelSummary("idea_delete");
    expect(summary.ideaLookupCount).toBe(0);
    expect(summary.ideaAddedCount).toBe(0);
    expect(summary.usedToolCount).toBe(1);
  });

  it("没有 idea 调用时新片段不出现；脚本兜底照旧", async () => {
    // i18n 的初始语言是 en（实测，`nested-tool-summary-labels.test.ts` 也是每例先切 zh）——
    // 不断言中文就必须先切语言，否则拿到的是英文片段。
    await i18n.changeLanguage("zh");
    const blocks = [
      { type: "tool_use", id: "s-1", name: "codemode", input: {} },
      {
        type: "tool_result",
        toolUseId: "s-1",
        content: "ok",
      },
    ] as unknown as ContentBlock[];
    const display = buildToolDisplayBlocks(blocks);
    expect(display[0]?.type).toBe("process-summary");
    const texts = getProcessSummaryFragments(
      (display[0] as { summary: ProcessSummary }).summary,
      i18n.t,
    ).map((fragment) => fragment.text);
    expect(texts).toEqual(["已执行 1 个脚本"]);
  });

  it("文案：中文按次数说，英文走复数，图标同一族", async () => {
    await i18n.changeLanguage("zh");
    expect(
      getProcessSummaryFragments(
        { ...empty, ideaLookupCount: 2, ideaAddedCount: 1 },
        i18n.t,
      ).map((fragment) => fragment.text),
    ).toEqual(["已查阅 2 条想法", "已记录 1 条想法"]);

    await i18n.changeLanguage("en");
    const fragments = getProcessSummaryFragments(
      { ...empty, ideaLookupCount: 1, ideaAddedCount: 2 },
      i18n.t,
    );
    expect(fragments.map((fragment) => fragment.text)).toEqual([
      "Looked up 1 idea",
      "Saved 2 ideas",
    ]);
    expect(fragments.map((fragment) => fragment.iconType)).toEqual([
      "ideas",
      "ideas",
    ]);
  });
});
