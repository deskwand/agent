import { describe, expect, it } from "vitest";
import {
  evaluateToolCall,
  normalizeRecipient,
} from "../../main/agents/outbound-guard";
import {
  ALL_RISKY_DISABLED,
  ALL_RISKY_ENABLED,
} from "../../shared/agent-risky-capabilities";

const agent = (
  over: Partial<{
    instructions: string;
    trustedRecipients: string[];
    riskyCapabilities: typeof ALL_RISKY_ENABLED;
  }> = {},
) => ({
  instructions: "Report to alice@x.com weekly.",
  trustedRecipients: [] as string[],
  riskyCapabilities: ALL_RISKY_ENABLED,
  ...over,
});

describe("outbound guard", () => {
  it("blocks bash when shell is disabled, with exact reason", () => {
    const d = evaluateToolCall(
      "bash",
      {},
      agent({ riskyCapabilities: ALL_RISKY_DISABLED }),
    );
    expect(d).toEqual({
      action: "block",
      reason:
        "Blocked: this teammate does not have the shell capability enabled. Do not try another tool to get around this; tell the user in your report if you need it.",
    });
  });

  it("allows bash when shell is enabled", () => {
    expect(evaluateToolCall("bash", {}, agent())).toEqual({ action: "allow" });
  });

  it("blocks Agent only when shell is off", () => {
    expect(evaluateToolCall("Agent", {}, agent())).toEqual({
      action: "allow",
    });
    expect(
      evaluateToolCall(
        "Agent",
        {},
        agent({
          riskyCapabilities: { ...ALL_RISKY_ENABLED, shell: false },
        }),
      ),
    ).toEqual({
      action: "block",
      reason:
        "Blocked: subagents are unavailable because this teammate does not have the shell capability enabled.",
    });
  });

  it("allows read", () => {
    expect(evaluateToolCall("read", { path: "a" }, agent())).toEqual({
      action: "allow",
    });
  });

  it("allows email to a recipient named in instructions", () => {
    expect(
      evaluateToolCall(
        "mcp__mail__email_send",
        { to: ["Alice <ALICE@x.com>"], body: "hi" },
        agent(),
      ),
    ).toEqual({ action: "allow" });
  });

  it("allows email to a trusted recipient", () => {
    expect(
      evaluateToolCall(
        "mcp__mail__email_send",
        { to: ["bob@x.com"] },
        agent({ trustedRecipients: ["Bob@X.com"] }),
      ),
    ).toEqual({ action: "allow" });
  });

  it("asks for a stranger", () => {
    expect(
      evaluateToolCall(
        "mcp__mail__email_send",
        { to: ["eve@x.com"], body: "hello" },
        agent(),
      ),
    ).toEqual({
      action: "ask",
      recipients: ["eve@x.com"],
      hasAttachments: false,
      preview: "hello",
    });
  });

  it("asks when a trusted recipient gets an attachment", () => {
    const d = evaluateToolCall(
      "email_send",
      { to: ["alice@x.com"], attachments: ["/a.pdf"] },
      agent(),
    );
    expect(d).toMatchObject({
      action: "ask",
      recipients: [],
      hasAttachments: true,
    });
  });

  it("blocks secrets in content", () => {
    const d = evaluateToolCall(
      "mcp__mail__email_send",
      { to: ["alice@x.com"], body: `key sk-${"a".repeat(24)}` },
      agent(),
    );
    expect(d).toMatchObject({ action: "block" });
  });

  it("allows email_respond reply without recipients", () => {
    expect(
      evaluateToolCall("email_respond", { response_type: "reply" }, agent()),
    ).toEqual({ action: "allow" });
  });

  it("asks for email_respond forward to a stranger", () => {
    expect(
      evaluateToolCall(
        "email_respond",
        { response_type: "forward", to: ["eve@x.com"] },
        agent(),
      ),
    ).toMatchObject({ action: "ask", recipients: ["eve@x.com"] });
  });

  it("asks for slack post to untrusted channel", () => {
    expect(
      evaluateToolCall(
        "mcp__slack__post_message",
        { channel: "C123", text: "hi" },
        agent(),
      ),
    ).toMatchObject({ action: "ask", recipients: ["c123"], preview: "hi" });
  });

  it("allows slack list", () => {
    expect(evaluateToolCall("mcp__slack__list_messages", {}, agent())).toEqual({
      action: "allow",
    });
  });

  it("asks with unknown recipient when none found", () => {
    expect(
      evaluateToolCall("mcp__x__send_thing", { text: "yo" }, agent()),
    ).toMatchObject({ action: "ask", recipients: ["(unknown recipient)"] });
  });

  it("normalizes recipients", () => {
    expect(normalizeRecipient("Bob <BOB@x.com>")).toBe("bob@x.com");
    expect(normalizeRecipient("  C123 ")).toBe("c123");
  });

  describe("review fixes", () => {
    it("checks every address inside one recipient string", () => {
      const a = agent({
        instructions: "Report to boss@co.",
        trustedRecipients: [],
      });
      expect(
        evaluateToolCall("email_send", { to: ["Boss <boss@co>, evil@x"] }, a),
      ).toMatchObject({ action: "ask", recipients: ["evil@x"] });
      expect(
        evaluateToolCall("email_send", { to: ["boss@co; evil@x"] }, a),
      ).toMatchObject({ action: "ask", recipients: ["evil@x"] });
    });

    it("blocks SubagentWorkflow only when shell is off", () => {
      expect(evaluateToolCall("SubagentWorkflow", {}, agent())).toEqual({
        action: "allow",
      });
      expect(
        evaluateToolCall(
          "subagentworkflow",
          {},
          agent({ riskyCapabilities: { ...ALL_RISKY_ENABLED, shell: false } }),
        ),
      ).toMatchObject({ action: "block" });
    });

    it("asks for a forward to a known recipient unless attachments are off", () => {
      const a = agent({ trustedRecipients: ["bob@x.com"] });
      expect(
        evaluateToolCall(
          "email_respond",
          { response_type: "forward", to: ["bob@x.com"] },
          a,
        ),
      ).toMatchObject({ action: "ask", hasAttachments: true });
      expect(
        evaluateToolCall(
          "email_respond",
          {
            response_type: "forward",
            to: ["bob@x.com"],
            include_attachments: false,
          },
          a,
        ),
      ).toEqual({ action: "allow" });
    });

    it("detects noun-style and camelCase MCP send tools", () => {
      expect(
        evaluateToolCall(
          "mcp__feishu__im_v1_message_create",
          { receive_id: "ou_1" },
          agent(),
        ),
      ).toMatchObject({ action: "ask" });
      expect(
        evaluateToolCall("mcp__x__sendMessage", { text: "hi" }, agent()),
      ).toMatchObject({ action: "ask" });
      expect(
        evaluateToolCall("mcp__x__get_message", { id: "1" }, agent()),
      ).toEqual({ action: "allow" });
    });

    it("falls back to unknown recipient when the recipient key is blank", () => {
      expect(
        evaluateToolCall(
          "mcp__x__send_thing",
          { to: "", receive_id: "r1" },
          agent(),
        ),
      ).toMatchObject({ action: "ask", recipients: ["(unknown recipient)"] });
    });

    it("matches instructions on token boundaries only", () => {
      const a = agent({ instructions: "Mail lisa@x.com daily." });
      expect(
        evaluateToolCall("email_send", { to: ["a@x.com"] }, a),
      ).toMatchObject({ action: "ask", recipients: ["a@x.com"] });
      expect(evaluateToolCall("email_send", { to: ["lisa@x.com"] }, a)).toEqual(
        { action: "allow" },
      );
    });
  });
});
