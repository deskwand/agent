import { describe, expect, it } from "vitest";
import { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * 回归 lint：DeskBend 的会话收尾必须走会发 `session_shutdown` 的
 * `AgentSessionRuntime.dispose()`。直接 `session.dispose()` 不发该事件，
 * 内置 MCP 扩展因此不会关闭连接 —— stdio 子进程会一直活着（见 spec §2.2）。
 *
 * 真正的不变式守卫是 scripts/mcp-session-teardown-check.mjs（起真进程断言）。
 */
describe("pi 会话收尾走 runtime", () => {
  const agentRunner = read("src/main/agent/agent-runner.ts");

  it("创建点用 AgentSessionRuntime 包住会话", () => {
    expect(agentRunner).toContain("new AgentSessionRuntime(");
  });

  it("直接 dispose 只允许出现在 helper 的兜底分支里", () => {
    const direct = agentRunner.match(/\.session\.dispose\(\)/g) ?? [];
    expect(direct.length).toBe(1);
    const helperStart = agentRunner.indexOf("private disposeCachedPiSession(");
    expect(helperStart).toBeGreaterThanOrEqual(0);
    const helperEnd = agentRunner.indexOf("\n  }\n", helperStart);
    // 唯一的直接 dispose 在 helper 内部：那是冷启动压缩临时会话的兜底
    // （它不加载扩展、没有 MCP 连接）。
    expect(agentRunner.slice(helperStart, helperEnd)).toContain(
      "cached.session.dispose()",
    );
  });

  it("8 处收尾都走统一入口", () => {
    const calls = agentRunner.match(/this\.disposeCachedPiSession\(/g) ?? [];
    expect(calls.length).toBe(8);
  });

  it("收尾集中在单一私有方法里", () => {
    // 不断言 helper 内部的字面量：prettier 会把 `cached.runtime.dispose()` 折成多行。
    // 它想守的不变式已由「不再有 .session.dispose()」+「恰好 8 处调用」+「helper 存在」三者覆盖。
    expect(agentRunner).toContain("private disposeCachedPiSession(");
  });

  it("一次性 fork runner 跑完收回会话（否则每次 review 都留一组进程）", () => {
    expect(read("src/main/agent/background-review.ts")).toContain(
      "reviewRunner.clearAllSdkSessions()",
    );
    expect(read("src/main/skills/curator-service.ts")).toContain(
      "forkRunner.clearAllSdkSessions()",
    );
  });

  it("退出前走一次正常收尾（best-effort）", () => {
    const index = read("src/main/index.ts");
    const start = index.indexOf('app.on("before-quit"');
    const end = index.indexOf("// IPC Handlers", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(index.slice(start, end)).toContain("clearAllCachedAgentSessions()");
  });

  it("退出路径的收尾不被 isCleaningUp 守卫挡住（Windows/Linux 关窗也生效）", () => {
    // window-all-closed → cleanupSandboxResources() 已经置位 isCleaningUp，
    // before-quit 里的守卫会直接 return —— 收尾必须排在它前面，否则只是文档承诺。
    const index = read("src/main/index.ts");
    const start = index.indexOf('app.on("before-quit"');
    const end = index.indexOf("// IPC Handlers", start);
    const block = index.slice(start, end);
    const call = block.indexOf("clearAllCachedAgentSessions()");
    const guard = block.indexOf("if (isCleaningUp)");
    expect(call).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(call).toBeLessThan(guard);
  });

  it("一次性 fork runner 在 run() 抛错时也收尾（try/finally）", () => {
    for (const [file, runner] of [
      ["src/main/agent/background-review.ts", "reviewRunner"],
      ["src/main/skills/curator-service.ts", "forkRunner"],
    ] as const) {
      const src = read(file);
      const call = src.indexOf(`${runner}.clearAllSdkSessions()`);
      expect(
        call,
        `${file}: ${runner}.clearAllSdkSessions()`,
      ).toBeGreaterThanOrEqual(0);
      // 收尾必须在 finally 里：run() 抛错时也要执行（否则 fork 的会话活到退出）
      const finallyIdx = src.lastIndexOf("} finally {", call);
      expect(
        finallyIdx,
        `${file}: finally before clearAllSdkSessions`,
      ).toBeGreaterThanOrEqual(0);
      expect(call - finallyIdx).toBeLessThan(400);
    }
  });

  it("helper 的兜底分支可观测（临时会话无 runtime）", () => {
    const helperStart = agentRunner.indexOf("private disposeCachedPiSession(");
    const helperEnd = agentRunner.indexOf("\n  }\n", helperStart);
    const body = agentRunner.slice(helperStart, helperEnd);
    const fallbackStart = body.indexOf("if (!cached.runtime)");
    expect(fallbackStart).toBeGreaterThanOrEqual(0);
    const fallbackEnd = body.indexOf("return;", fallbackStart);
    // 正常路径也要留痕迹：将来新增一个“加载了扩展却忘了带 runtime”的构造点
    // 时，这条能在日志里被发现，而不是静默回到本 bug。
    expect(body.slice(fallbackStart, fallbackEnd)).toContain(
      "without an MCP runtime",
    );
  });
});

/**
 * 我们依赖的上游行为：`AgentSessionRuntime.dispose()` 先发 `session_shutdown`
 * （内置 MCP 扩展在这个事件里关闭连接），再 `session.dispose()`。
 * 若上游改了语义，这条会变红 —— 而不是静默退回「进程不回收」。
 *
 * 用假 session：只关心调用顺序，不需要真会话/模型。
 */
function makeFakeRuntime(order: string[]) {
  const session = {
    extensionRunner: {
      hasHandlers: (type: string) => type === "session_shutdown",
      emit: async (event: { type: string }) => {
        order.push(`emit:${event.type}`);
      },
    },
    dispose: () => {
      order.push("session.dispose");
    },
  };
  return new AgentSessionRuntime(
    session as never,
    {} as never,
    (() => {
      throw new Error("unused");
    }) as never,
    [],
  );
}

describe("AgentSessionRuntime.dispose() 契约", () => {
  it("先发 session_shutdown，再 dispose 会话", async () => {
    const order: string[] = [];
    await makeFakeRuntime(order).dispose();
    expect(order).toEqual(["emit:session_shutdown", "session.dispose"]);
  });

  it("重复 dispose 不产生未处理的 rejection", async () => {
    const order: string[] = [];
    const runtime = makeFakeRuntime(order);
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      // 复刻 disposeCachedPiSession 的调用方式
      const call = (r: AgentSessionRuntime) =>
        r.dispose().catch(() => undefined);
      await Promise.all([call(runtime), call(runtime)]);
      // 给未处理的 rejection 一个冒头的机会
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    // 两轮都要完整跑完（emit + dispose 各两次），且没有任何未处理 rejection。
    // 不假设交错顺序：两次 dispose 并发时 emit 会先都发出。
    expect(order.filter((e) => e === "emit:session_shutdown")).toHaveLength(2);
    expect(order.filter((e) => e === "session.dispose")).toHaveLength(2);
    expect(rejections).toEqual([]);
  });
});
