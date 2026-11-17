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
 * `workspace_peers` 必须在过程摘要里有自己的归类与文案 —— 落进通用的
 * 「已使用 N 个工具」就是 AGENTS.md §4 禁止的"未分组工具展示"。
 */
const empty: ProcessSummary = {
  readCount: 0,
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

function topLevelSummary(name: string): ProcessSummary {
  return firstSummary([
    { type: "tool_use", id: "t-1", name, input: {} } as ContentBlock,
    { type: "tool_result", toolUseId: "t-1", content: "ok" } as ContentBlock,
  ]);
}

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

describe("workspace_peers 的摘要分组", () => {
  it("顶层调用计入「查看并行会话」，不落进通用工具数", () => {
    const summary = topLevelSummary("workspace_peers");
    expect(summary.peerCheckCount).toBe(1);
    expect(summary.usedToolCount).toBe(0);
  });

  it("codemode 里调用走同一组", () => {
    const summary = nestedSummary("workspace_peers");
    expect(summary.peerCheckCount).toBe(1);
    expect(summary.usedToolCount).toBe(0);
  });

  it("没有调用时不出现该片段", () => {
    expect(
      getProcessSummaryFragments({ ...empty }, i18n.t).map(
        (fragment) => fragment.text,
      ),
    ).not.toContain(expect.stringContaining("并行会话"));
  });

  it("中英文案按次数走复数，图标同一族", async () => {
    await i18n.changeLanguage("zh");
    expect(
      getProcessSummaryFragments({ ...empty, peerCheckCount: 2 }, i18n.t).map(
        (fragment) => fragment.text,
      ),
    ).toEqual(["查看了 2 次并行会话"]);

    await i18n.changeLanguage("en");
    const fragments = getProcessSummaryFragments(
      { ...empty, peerCheckCount: 1 },
      i18n.t,
    );
    expect(fragments.map((fragment) => fragment.text)).toEqual([
      "Checked 1 parallel session",
    ]);
    expect(fragments.map((fragment) => fragment.iconType)).toEqual(["peers"]);
  });
});
