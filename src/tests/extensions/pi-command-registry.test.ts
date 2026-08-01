import { describe, it, expect } from "vitest";
import {
  BUILTIN_COMMANDS,
  buildInterceptedPrompt,
  isExtensionCommand,
  mergeCommandEntries,
  resolveInvocationName,
  type PiCommandEntry,
} from "../../main/extensions/pi-command-registry";

describe("mergeCommandEntries", () => {
  it("merges builtin and extension commands", () => {
    const ext: PiCommandEntry[] = [{ name: "plan", source: "extension" }];
    const merged = mergeCommandEntries(undefined, ext);
    expect(merged.map((c) => c.name)).toEqual(["compact", "goal", "plan"]);
  });

  it("builtin wins dedup when extension registers same name", () => {
    const ext: PiCommandEntry[] = [
      { name: "goal", source: "extension" },
      { name: "plan", source: "extension" },
    ];
    const merged = mergeCommandEntries(undefined, ext);
    const goal = merged.find((c) => c.name === "goal");
    expect(goal?.source).toBe("builtin");
    expect(merged).toHaveLength(3); // compact, goal(builtin), plan
  });

  it("merges with cached list (cached first, hostExt appended, dedup)", () => {
    const cached: PiCommandEntry[] = [{ name: "hello", source: "extension" }];
    const hostExt: PiCommandEntry[] = [
      { name: "hello", source: "extension" },
      { name: "todos", source: "extension" },
    ];
    const merged = mergeCommandEntries(cached, hostExt);
    expect(merged.map((c) => c.name)).toEqual(["compact", "goal", "hello", "todos"]);
  });

  it("host missing falls back to cached-only", () => {
    const cached: PiCommandEntry[] = [{ name: "hello", source: "extension" }];
    expect(mergeCommandEntries(cached, undefined).map((c) => c.name)).toEqual([
      "compact",
      "goal",
      "hello",
    ]);
  });

  it("BUILTIN_COMMANDS is compact/goal", () => {
    expect(BUILTIN_COMMANDS.map((c) => c.name)).toEqual(["compact", "goal"]);
  });
});

describe("isExtensionCommand", () => {
  it("matches extension commands only", () => {
    const merged = mergeCommandEntries(undefined, [
      { name: "plan", source: "extension" },
    ]);
    expect(isExtensionCommand(merged, "/plan")).toBe("plan");
    expect(isExtensionCommand(merged, "/plan with args")).toBe("plan");
    expect(isExtensionCommand(merged, "/goal")).toBeNull(); // builtin 不命中
    expect(isExtensionCommand(merged, "/unknown")).toBeNull();
    expect(isExtensionCommand(merged, "hello")).toBeNull();
  });
});

describe("resolveInvocationName", () => {
  const ext = (name: string): PiCommandEntry => ({ name, source: "extension" });

  it("returns the name unchanged when unique", () => {
    const entries = [ext("game"), ext("demo")];
    expect(resolveInvocationName(entries, "game")).toBe("game");
    expect(resolveInvocationName(entries, "demo")).toBe("demo");
  });

  it("applies the :occurrence suffix for duplicates in registration order", () => {
    const entries = [ext("plan"), ext("todos"), ext("plan"), ext("game")];
    expect(resolveInvocationName(entries, "plan")).toBe("plan:1"); // 第一个注册者
  });

  it("matches SDK resolveRegisteredCommands output", () => {
    // 对照 SDK 的规则：counts>1 → `${name}:${occurrence}`（occurrence 从 1 起，按注册顺序）
    const entries = [ext("plan"), ext("plan"), ext("plan"), ext("game"), ext("game")];
    expect(resolveInvocationName(entries, "plan")).toBe("plan:1");
    expect(resolveInvocationName(entries, "game")).toBe("game:1");
  });

  it("returns the name when not present", () => {
    expect(resolveInvocationName([ext("plan")], "unknown")).toBe("unknown");
  });

  it("intercepted commands must not be prefixed by image guidance (I2)", () => {
    // 语义：拦截命中（自包含命令）时跳过 imageGuidancePrefix 拼接，
    // 保证 finalPrompt 仍以 "/" 开头（SDK startsWith 检测）。
    const mapped = buildInterceptedPrompt([{ name: "plan" }, { name: "plan" }], "/plan");
    expect(mapped?.finalPrompt).toBe("/plan:1");
    // 未命中时前缀可正常拼接（普通消息路径不受影响）
    expect(buildInterceptedPrompt([{ name: "game" }], "hello")).toBeNull();
  });

  it("handles takenInvocationNames collision like the SDK", () => {
    // 原始名 "plan:1" 抢先占用 plan:1 → 后续 plan 从 plan:2 开始
    const entries = [ext("plan:1"), ext("plan"), ext("plan")];
    expect(resolveInvocationName(entries, "plan")).toBe("plan:2");
    expect(resolveInvocationName(entries, "plan:1")).toBe("plan:1");
  });
});

describe("buildInterceptedPrompt", () => {
  it("maps duplicate command names to :1 invocation", () => {
    const r = buildInterceptedPrompt(
      [{ name: "plan" }, { name: "todos" }, { name: "plan" }],
      "/plan with args",
    );
    expect(r).toEqual({ hit: "plan", finalPrompt: "/plan:1 with args" });
  });

  it("passes unique names through unchanged", () => {
    const r = buildInterceptedPrompt([{ name: "game" }], "/game snake");
    expect(r).toEqual({ hit: "game", finalPrompt: "/game snake" });
  });

  it("returns null when no command matches", () => {
    expect(buildInterceptedPrompt([{ name: "game" }], "/nope x")).toBeNull();
    expect(buildInterceptedPrompt([{ name: "game" }], "plain text")).toBeNull();
  });
});
