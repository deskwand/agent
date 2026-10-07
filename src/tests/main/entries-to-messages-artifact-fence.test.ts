import { describe, expect, it } from "vitest";
import { entriesToMessages } from "../../main/session/entries-to-messages";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

const FENCE = '```artifact\n{"path":"out/a.html","render":"inline"}\n```';

function assistantEntry(id: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-10-07T00:00:00.000Z",
    message: { role: "assistant", content: [{ type: "text", text }] },
  } as unknown as SessionEntry;
}

/**
 * 历史回放这条通道必须把围栏原样带到渲染层：渲染层靠它在原文里的位置拆出产物块。
 * 主进程这边若"顺手"清洗掉，历史消息就会退回另一条通道（trace step），
 * 两条通道的时间差正是"进来先看到列表再消失"的来源。
 */
describe("历史回放保留围栏", () => {
  it("assistant 文本块原样带出围栏", () => {
    const messages = entriesToMessages(
      [assistantEntry("m1", `前\n${FENCE}\n后`)],
      "s1",
    );
    expect(JSON.stringify(messages)).toContain("```artifact");
  });
});
