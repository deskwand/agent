import { expect, it } from "vitest";
import { normalizeSessionKind } from "../../shared/session-kind";
import {
  resolveSessionTurnPolicy,
  VOICE_ONLY_TOOLS,
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
    // 语音专属工具（set_voice）不进普通会话：白名单之外还有一道按会话类型的过滤。
    const available = ["read", "bash", ...VOICE_TURN.tools];
    const ordinaryAvailable = available.filter(
      (name) => !VOICE_ONLY_TOOLS.has(name),
    );
    expect(
      resolveSessionTurnPolicy({ kind, allowedTools: [] }, "voice", available),
    ).toEqual({ profile: undefined, activeToolNames: ordinaryAvailable });
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
