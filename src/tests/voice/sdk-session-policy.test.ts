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
    getActiveToolNames: () => active,
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

it("resets actual SDK tools and cached format on spoken, typed, and ordinary turns, skipping no-op rebuilds", () => {
  const session = VOICE_SESSION;
  const registered = ["read", "bash", "write", ...VOICE_TURN.tools];
  const sdk = makeSdk(registered);
  const cache: { turnProfile?: TurnProfile } = {};
  applySessionTurnPolicyToSdk(session, "voice", sdk, cache);
  expect(cache.turnProfile).toBe(VOICE_TURN);
  expect(sdk.call("web_search")).toBe("web_search");
  expect(() => sdk.call("write")).toThrow("inactive tool");
  applySessionTurnPolicyToSdk(session, undefined, sdk, cache);
  expect(cache.turnProfile).toBeUndefined();
  expect(() => sdk.call("read")).toThrow("inactive tool");
  applySessionTurnPolicyToSdk(
    { ...session, kind: "ordinary" },
    "voice",
    sdk,
    cache,
  );
  expect(cache.turnProfile).toBeUndefined();
  expect(sdk.call("write")).toBe("write");
  applySessionTurnPolicyToSdk(
    { ...session, allowedTools: ["web_search"] },
    undefined,
    sdk,
    cache,
  );
  expect(sdk.active).toEqual(["web_search"]);
  // 4 次调用里只有 3 次真的改写了名单：第 2 次（voice 会话 + 未指定档案）算出来的名单与第 1 次
  // 相同（voice 轮的名单由 VOICE_TURN.tools ∩ allowedTools 决定，requestedProfile 只影响
  // 提示词段），被"同名跳过"挡下。
  expect(sdk.setActiveToolsByName).toHaveBeenCalledTimes(3);
});

it("每轮都不会把降到 codemode 的工具重新声明，同时保住 codemode 网关", () => {
  const degraded = [
    "internal_browser_screenshot",
    "office_read_xlsx",
    "vision_describe",
  ];
  // 注册表是 Map，名字唯一。原来这里把 read/bash/write 写了两遍 —— 那时输入是 policyList，
  // 重复项无影响；现在输入 = 注册表，重复项会被原样带进 active，所以先归一。
  const registered = ["read", "bash", "write", "codemode", ...degraded];
  const sdk = makeSdk(registered, {
    codemode: "codemode",
    internal_browser_screenshot: "codemode",
    office_read_xlsx: "codemode",
    vision_describe: "codemode",
  });
  applySessionTurnPolicyToSdk(
    { ...VOICE_SESSION, kind: "ordinary" },
    undefined,
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

it("注册表里没有 codemode 工具时不会凭空激活 codemode", () => {
  // 名单来源改成注册表之后，这条守的是"补挂只补注册表里真有的 codemode"：
  // 注册表里没它，就不该出现，也不能凭空造出这个名字。
  const sdk = makeSdk(["read", "bash", "write"]);
  applySessionTurnPolicyToSdk(
    { ...VOICE_SESSION, kind: "ordinary" },
    undefined,
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
    sdk,
  );
  expect(sdk.active).toEqual(["web_search"]);
});

it("普通轮：注册表里的工具不再被策略摘掉，降级工具照旧不声明", () => {
  const degraded = [
    "internal_browser_click",
    "office_read_xlsx",
    "vision_describe",
  ];
  const registered = [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "powershell",
    "web_search",
    "fetch_content",
    "get_search_content",
    "todo_write",
    "ask_user",
    "Agent",
    "SubagentWorkflow",
    "get_subagent_result",
    "steer_subagent",
    "codemode",
    "set_voice",
    ...degraded,
  ];
  const sdk = makeSdk(registered, {
    codemode: "codemode",
    internal_browser_click: "codemode",
    office_read_xlsx: "codemode",
    vision_describe: "codemode",
  });
  applySessionTurnPolicyToSdk(
    { ...VOICE_SESSION, kind: "ordinary" },
    undefined,
    sdk,
  );

  // 修复前这里是 inactive tool：四个子代理工具与 SDK 基础工具都不在策略清单里。
  expect(sdk.call("Agent")).toBe("Agent");
  expect(sdk.call("get_subagent_result")).toBe("get_subagent_result");
  expect(sdk.call("grep")).toBe("grep");
  expect(sdk.call("ls")).toBe("ls");
  expect(sdk.call("powershell")).toBe("powershell");

  // 整集合不变量：非语音轮的 active = 注册表里全部可声明工具（减去 set_voice）+ codemode。
  // 任何静默丢工具都会红 —— 不只盯这次事故里那几个受害者。
  const expected = new Set(
    registered.filter((n) => n !== "set_voice" && !degraded.includes(n)),
  );
  expect(new Set(sdk.active)).toEqual(expected);
});

it("名单没变时不重建系统提示词", () => {
  const sdk = makeSdk(["read", "bash", "Agent", "web_search"]);
  const session: Session = { ...VOICE_SESSION, kind: "ordinary" };
  applySessionTurnPolicyToSdk(session, undefined, sdk);
  applySessionTurnPolicyToSdk(session, undefined, sdk);
  expect(sdk.setActiveToolsByName).toHaveBeenCalledTimes(1);
  expect(sdk.active).toEqual(["read", "bash", "Agent", "web_search"]);
});
