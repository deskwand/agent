import { expect, it, vi } from "vitest";
import { applySessionTurnPolicyToSdk } from "../../main/agent/agent-runner";
import { VOICE_TURN, type TurnProfile } from "../../main/agent/turn-profiles";
import type { Session } from "../../renderer/types";
it("resets actual SDK tools and cached format on spoken, typed, and ordinary turns", () => {
  const session: Session = {
    id: "V",
    kind: "voice",
    title: "V",
    status: "idle",
    mountedPaths: [],
    allowedTools: [...VOICE_TURN.tools],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
  const registered = ["read", "bash", "write", ...VOICE_TURN.tools];
  let active: string[] = [];
  const sdk = {
    setActiveToolsByName: vi.fn((names: string[]) => {
      active = [...names];
    }),
    call(name: string) {
      if (!active.includes(name)) throw new Error("inactive tool");
      return name;
    },
  };
  const cache: { turnProfile?: TurnProfile } = {};
  applySessionTurnPolicyToSdk(session, "voice", registered, sdk, cache);
  expect(cache.turnProfile).toBe(VOICE_TURN);
  expect(sdk.call("web_search")).toBe("web_search");
  expect(() => sdk.call("write")).toThrow("inactive tool");
  applySessionTurnPolicyToSdk(session, undefined, registered, sdk, cache);
  expect(cache.turnProfile).toBeUndefined();
  expect(() => sdk.call("read")).toThrow("inactive tool");
  applySessionTurnPolicyToSdk(
    { ...session, kind: "ordinary" },
    "voice",
    registered,
    sdk,
    cache,
  );
  expect(cache.turnProfile).toBeUndefined();
  expect(sdk.call("write")).toBe("write");
  applySessionTurnPolicyToSdk(
    { ...session, allowedTools: ["web_search"] },
    undefined,
    registered,
    sdk,
    cache,
  );
  expect(active).toEqual(["web_search"]);
  expect(sdk.setActiveToolsByName).toHaveBeenCalledTimes(4);
});
