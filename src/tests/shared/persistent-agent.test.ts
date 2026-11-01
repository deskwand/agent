import { describe, expect, it } from "vitest";
import {
  parseAgentWakeup,
  wrapAgentWakeup,
} from "../../shared/persistent-agent";
import { normalizeSessionKind } from "../../shared/session-kind";

describe("agent wakeup tag", () => {
  it("round-trips the body", () => {
    expect(parseAgentWakeup(wrapAgentWakeup("a\nb"))).toBe("a\nb");
  });

  it("rejects text that is not wholly wrapped", () => {
    expect(parseAgentWakeup("hi <agent_wakeup>x</agent_wakeup>")).toBeNull();
    expect(parseAgentWakeup("plain text")).toBeNull();
  });
});

describe("normalizeSessionKind", () => {
  it("accepts agent and falls back to ordinary", () => {
    expect(normalizeSessionKind("agent")).toBe("agent");
    expect(normalizeSessionKind("bogus")).toBe("ordinary");
  });
});
