import { expect, it } from "vitest";
import { normalizeSessionKind } from "../../shared/session-kind";
import {
  resolveSessionTurnPolicy,
  VOICE_TURN,
  appendVoiceSection,
} from "../../main/agent/turn-profiles";

it.each([undefined, null, "ordinary", "unknown"])(
  "defaults %s to ordinary",
  (kind) => {
    expect(normalizeSessionKind(kind)).toBe("ordinary");
  },
);
it("keeps voice", () => expect(normalizeSessionKind("voice")).toBe("voice"));
it("restricts voice input and typed continuation independently of output format", () => {
  const session = {
    kind: "voice" as const,
    allowedTools: [...VOICE_TURN.tools],
  };
  const available = ["read", "bash", ...VOICE_TURN.tools];
  const spoken = resolveSessionTurnPolicy(session, "voice", available);
  const typed = resolveSessionTurnPolicy(session, undefined, available);
  expect(spoken.activeToolNames).toEqual(VOICE_TURN.tools);
  expect(spoken.profile?.thinkingLevel).toBe("off");
  expect(typed.activeToolNames).toEqual(VOICE_TURN.tools);
  expect(typed.profile).toBeUndefined();
  expect(appendVoiceSection("base", typed.profile)).toBe("base");
  expect(typed.profile?.thinkingLevel ?? "high").toBe("high");
});
it.each([undefined, "ordinary" as const])(
  "ignores voice requests for %s sessions",
  (kind) => {
    const available = ["read", "bash", ...VOICE_TURN.tools];
    expect(
      resolveSessionTurnPolicy({ kind, allowedTools: [] }, "voice", available),
    ).toEqual({ profile: undefined, activeToolNames: available });
  },
);
it("never expands a voice record's stored tool restriction", () => {
  const session = {
    kind: "voice" as const,
    allowedTools: ["web_search", "bash"],
  };
  expect(
    resolveSessionTurnPolicy(session, undefined, ["web_search", "bash"])
      .activeToolNames,
  ).toEqual(["web_search"]);
  expect(
    resolveSessionTurnPolicy(
      { ...session, allowedTools: [] },
      "voice",
      VOICE_TURN.tools,
    ).activeToolNames,
  ).toEqual([]);
  expect(
    resolveSessionTurnPolicy(session, "voice", []).activeToolNames,
  ).toEqual([]);
});
