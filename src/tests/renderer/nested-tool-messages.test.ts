import { expect, it } from "vitest";
import { projectNestedToolMessages } from "../../renderer/utils/nested-tool-display";
import { normalizeNestedToolCalls } from "../../shared/nested-tool-calls";
import type { Message } from "../../renderer/types";

it("finds earlier same-turn results without moving the parent host or mutating messages", () => {
  const messages: Message[] = [
    {
      id: "r",
      sessionId: "s",
      role: "assistant",
      turnId: "t",
      timestamp: 1,
      content: [
        {
          type: "tool_result",
          toolUseId: "p",
          content: "done",
          nestedCalls: normalizeNestedToolCalls(
            "p",
            {
              complete: true,
              calls: [
                {
                  id: "c",
                  name: "read",
                  status: "ok",
                  arguments: { path: "a" },
                },
              ],
            },
            undefined,
            "ok",
          ),
        },
      ],
    },
    {
      id: "u",
      sessionId: "s",
      role: "assistant",
      turnId: "t",
      timestamp: 2,
      content: [
        { type: "text", text: "kept" },
        {
          type: "tool_use",
          id: "p",
          name: "codemode",
          input: { code: "source" },
        },
      ],
    },
  ];
  const projected = projectNestedToolMessages(messages, {});
  expect(projected.map((message) => message.id)).toEqual(["u"]);
  expect(projected[0].content[0]).toEqual({ type: "text", text: "kept" });
  expect(projected[0].content[1]).toMatchObject({ id: "c", name: "read" });
  expect(messages[0].content[0]).toMatchObject({ toolUseId: "p" });
});

it("does not cross turns or mark unowned history active", () => {
  const messages: Message[] = ["old", "active", undefined].map(
    (turnId, index) => ({
      id: String(index),
      sessionId: "s",
      role: "assistant",
      turnId,
      timestamp: 1,
      content: [
        {
          type: "tool_use",
          id: String(index),
          name: "codemode",
          input: { code: "source" },
        },
      ],
    }),
  );
  const projected = projectNestedToolMessages(messages, {}, "active");
  expect(projected.map((message) => message.content[0])).toMatchObject([
    { trace: { status: "unfinished" } },
    { trace: { status: "running" } },
    { trace: { status: "unfinished" } },
  ]);
});
