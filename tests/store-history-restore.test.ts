import { describe, it, expect } from "vitest";
import { useAppStore } from "../src/renderer/store";
import type { Message } from "../src/renderer/types";

function decoratedMessage(id: string): Message {
  return {
    id,
    sessionId: "history-restore",
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "看看",
          "",
          "[Attached files - use Read tool to access them]:",
          "- 1.jpeg (263.6 KB) at path: .tmp/1-558dd2ae.jpeg",
        ].join("\n"),
      },
    ],
    timestamp: 1,
  };
}

function messagesOf(sessionId: string): Message[] {
  return useAppStore.getState().sessionStates[sessionId]?.messages ?? [];
}

describe("history ingest restores prompt decorations", () => {
  it("restores messages loaded as the history tail", () => {
    useAppStore
      .getState()
      .setMessagesTail("history-restore", [decoratedMessage("m1")], false);

    const [message] = messagesOf("history-restore");
    expect(message.content).toEqual([
      {
        type: "file_attachment",
        filename: "1.jpeg",
        relativePath: ".tmp/1-558dd2ae.jpeg",
        size: 269926,
      },
      { type: "text", text: "看看" },
    ]);
  });

  it("restores older messages prepended while paging up", () => {
    useAppStore
      .getState()
      .prependOlderMessages(
        "history-restore-page",
        [decoratedMessage("m2")],
        false,
      );

    const [message] = messagesOf("history-restore-page");
    expect(message.content.map((block) => block.type)).toEqual([
      "file_attachment",
      "text",
    ]);
    expect(message.id).toBe("m2");
  });

  it("restores messages set as the full history", () => {
    useAppStore
      .getState()
      .setMessages("history-restore-full", [decoratedMessage("m3")]);

    const [message] = messagesOf("history-restore-full");
    expect(message.content.map((block) => block.type)).toEqual([
      "file_attachment",
      "text",
    ]);
  });
});
