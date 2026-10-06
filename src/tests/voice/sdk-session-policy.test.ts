import { expect, it, vi } from "vitest";
import { applySessionTurnPolicyToSdk } from "../../main/agent/agent-runner";
import { VOICE_TURN, type TurnProfile } from "../../main/agent/turn-profiles";
import type { Session } from "../../renderer/types";

const VOICE_SESSION: Session = {
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

/**
 * 假 SDK 会话：记录 active 名单，并按名字挡住未激活的调用。
 * `getAllTools()` 只提供名字与 exposure —— 这正是 applySessionTurnPolicyToSdk 需要的全部。
 */
function makeSdk(
  registered: string[],
  exposures: Record<string, "codemode" | "direct"> = {},
) {
  let active: string[] = [];
  return {
    setActiveToolsByName: vi.fn((names: string[]) => {
      active = [...names];
    }),
    getAllTools: () =>
      registered.map((name) => ({
        name,
        exposure: exposures[name] ?? "direct",
      })),
    call(name: string) {
      if (!active.includes(name)) throw new Error("inactive tool");
      return name;
    },
    get active() {
      return active;
    },
  };
}

it("resets actual SDK tools and cached format on spoken, typed, and ordinary turns", () => {
  const session = VOICE_SESSION;
  const registered = ["read", "bash", "write", ...VOICE_TURN.tools];
  const sdk = makeSdk(registered);
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
  expect(sdk.active).toEqual(["web_search"]);
  expect(sdk.setActiveToolsByName).toHaveBeenCalledTimes(4);
});

it("每轮都不会把降到 codemode 的工具重新声明，同时保住 codemode 网关", () => {
  const policyList = [
    "read",
    "bash",
    "write",
    "internal_browser_screenshot",
    "office_read_xlsx",
    "vision_describe",
  ];
  const registered = ["read", "bash", "write", "codemode", ...policyList];
  const sdk = makeSdk(registered, {
    codemode: "codemode",
    internal_browser_screenshot: "codemode",
    office_read_xlsx: "codemode",
    vision_describe: "codemode",
  });
  applySessionTurnPolicyToSdk(
    { ...VOICE_SESSION, kind: "ordinary" },
    undefined,
    policyList,
    sdk,
  );
  expect(sdk.active).toEqual(["read", "bash", "write", "codemode"]);
  for (const name of [
    "internal_browser_screenshot",
    "office_read_xlsx",
    "vision_describe",
  ]) {
    expect(sdk.active, `${name} 不该被重新声明`).not.toContain(name);
  }
});

it("没有降级工具时不会凭空激活 codemode", () => {
  const policyList = ["read", "bash", "write"];
  const sdk = makeSdk([...policyList, "codemode"]);
  applySessionTurnPolicyToSdk(
    { ...VOICE_SESSION, kind: "ordinary" },
    undefined,
    policyList,
    sdk,
  );
  expect(sdk.active).toEqual(["read", "bash", "write"]);
});

it("语音轮的窄名单同样按 exposure 过滤", () => {
  const registered = ["read", "web_search", "internal_browser_screenshot"];
  const sdk = makeSdk(registered, { internal_browser_screenshot: "codemode" });
  applySessionTurnPolicyToSdk(
    {
      ...VOICE_SESSION,
      allowedTools: ["web_search", "internal_browser_screenshot"],
    },
    "voice",
    registered,
    sdk,
  );
  expect(sdk.active).toEqual(["web_search"]);
});
