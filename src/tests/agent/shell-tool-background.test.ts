import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BackgroundShellTaskManager } from "../../main/agent/background-shell-task-manager";
import {
  BACKGROUND_MAX_SECONDS,
  createShellDetachHub,
  describeShellResult,
  withShellBackground,
} from "../../main/agent/shell-tool-background";

const ctx = {} as never;

type ShellImpl = (
  params: { command: string; timeout?: number },
  signal?: AbortSignal,
) => Promise<unknown>;

function makeShellTool(impl: ShellImpl): ToolDefinition {
  return {
    name: "bash",
    label: "bash",
    description: "test bash",
    parameters: { type: "object", properties: { command: { type: "string" } } },
    async execute(
      _id: unknown,
      params: unknown,
      signal: AbortSignal | undefined,
    ) {
      return impl(params as { command: string; timeout?: number }, signal);
    },
  } as unknown as ToolDefinition;
}

const base = {
  sessionId: "s1",
  toolCallId: "call-1",
  toolName: "bash" as const,
  command: "npm ci",
  cwd: "/tmp",
  startedAt: 0,
  kill: () => undefined,
};

function makeHarness(impl: ShellImpl) {
  const observed: string[] = [];
  const manager = new BackgroundShellTaskManager({
    onEvent: (task) => observed.push(`${task.id}:${task.status}`),
  });
  const hub = createShellDetachHub();
  const [tool] = withShellBackground([makeShellTool(impl)], {
    manager,
    hub,
    sessionId: "s1",
    cwd: "/tmp",
    strings: { detachedNotice: (id, cmd) => `task #${id}: ${cmd}` },
    onSettled: (task) => observed.push(`settled:${task.id}`),
  });
  return { tool, manager, hub, observed };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ok = (text: string) => ({
  content: [{ type: "text", text }],
  structuredContent: { exit_code: 0, output: text },
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withShellBackground", () => {
  it("不碰非终端工具（引用相等）", () => {
    const tool = {
      name: "read",
      execute: async () => ({}),
    } as unknown as ToolDefinition;
    const [out] = withShellBackground([tool], {
      manager: new BackgroundShellTaskManager({ onEvent: () => undefined }),
      hub: createShellDetachHub(),
      sessionId: "s1",
      cwd: "/tmp",
      strings: { detachedNotice: () => "" },
      onSettled: () => undefined,
    });
    expect(out).toBe(tool);
  });

  it("前台完成：原样返回结果，不产生任务", async () => {
    const { tool, manager } = makeHarness(async () => ok("done"));
    const result = await tool.execute(
      "c1",
      { command: "ls" },
      undefined,
      undefined,
      ctx,
    );
    expect((result as { content: { text: string }[] }).content[0].text).toBe(
      "done",
    );
    expect(manager.list("s1")).toHaveLength(0);
  });

  it("把 120s 改成 1800s 交给底层（否则转后台会被自己的超时掐死）", async () => {
    const seen: number[] = [];
    const { tool } = makeHarness(async (params) => {
      seen.push(params.timeout ?? -1);
      return ok("");
    });
    await tool.execute(
      "c1",
      { command: "ls", timeout: 120 },
      undefined,
      undefined,
      ctx,
    );
    expect(seen).toEqual([BACKGROUND_MAX_SECONDS]);
  });

  it("run_in_background 立即返回合成结果，底层跑完结算一次", async () => {
    const gate = deferred<unknown>();
    const { tool, manager, observed } = makeHarness(() => gate.promise);
    const result = await tool.execute(
      "c1",
      { command: "npm ci", run_in_background: true },
      undefined,
      undefined,
      ctx,
    );
    expect(
      (result as { content: { text: string }[] }).content[0].text,
    ).toContain("task #1");
    expect(manager.list("s1")[0].status).toBe("detached");

    gate.resolve(ok("out"));
    await tick();
    expect(observed.filter((e) => e.startsWith("settled:"))).toEqual([
      "settled:1",
    ]);
    expect(manager.list("s1")).toHaveLength(0);
  });

  it("秒回命令 + run_in_background：走快路径，回真实结果且不建任务", async () => {
    const { tool, manager, observed } = makeHarness(async () => ok("instant"));
    const result = await tool.execute(
      "c1",
      { command: "echo hi", run_in_background: true },
      undefined,
      undefined,
      ctx,
    );
    // 宽限期内跑完 → 模型拿到的是真实输出，不是「已转后台」回执
    expect((result as { content: { text: string }[] }).content[0].text).toBe(
      "instant",
    );
    expect(manager.list("s1")).toHaveLength(0);
    expect(observed.filter((e) => e.startsWith("settled:"))).toEqual([]);
  });

  it("慢命令 + run_in_background：宽限期后才转后台", async () => {
    const gate = deferred<unknown>();
    const { tool, manager } = makeHarness(() => gate.promise);
    const pending = tool.execute(
      "c1",
      { command: "npm ci", run_in_background: true },
      undefined,
      undefined,
      ctx,
    );
    // 宽限期（300ms）过后才返回合成结果
    const result = await pending;
    expect(
      (result as { content: { text: string }[] }).content[0].text,
    ).toContain("task #1");
    expect(manager.list("s1")[0].status).toBe("detached");
    gate.resolve(ok("out"));
  });

  it("超限时退化为前台：前台超时与 Esc 仍然生效", async () => {
    let innerAborted = false;
    const outer = new AbortController();
    const { tool, manager, hub } = makeHarness(
      (_params, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            innerAborted = true;
            reject(new Error("aborted"));
          });
        }),
    );
    for (const id of ["x1", "x2", "x3"]) {
      manager.promote({ ...base, toolCallId: id, startedAt: 0 });
    }
    const pending = tool.execute(
      "c1",
      { command: "npm ci" },
      outer.signal,
      undefined,
      ctx,
    );
    // 人工点了转后台，但名额已满 → 退化前台后外层 abort 必须还能杀进来
    expect(hub.request("c1")).toBe(true);
    await new Promise((r) => setTimeout(r, 350));
    outer.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(innerAborted).toBe(true);
    expect(manager.list("s1")).toHaveLength(3);
  });

  it("中途 detach：返回合成结果，任务转入后台", async () => {
    const gate = deferred<unknown>();
    const { tool, manager, hub } = makeHarness(() => gate.promise);
    const pending = tool.execute(
      "c1",
      { command: "npm ci" },
      undefined,
      undefined,
      ctx,
    );
    expect(hub.request("c1")).toBe(true);
    const result = await pending;
    expect(
      (result as { content: { text: string }[] }).content[0].text,
    ).toContain("task #1");
    expect(manager.list("s1")[0].status).toBe("detached");
    gate.resolve(ok("done"));
  });

  it("未知 toolCallId 的 detach 返回 false", () => {
    const { hub } = makeHarness(async () => ok(""));
    expect(hub.request("nope")).toBe(false);
  });

  it("detach 之后外层 abort 不再传给内层", async () => {
    let innerAborted = false;
    const outer = new AbortController();
    const gate = deferred<unknown>();
    const { tool, hub } = makeHarness((_params, signal) => {
      signal?.addEventListener("abort", () => {
        innerAborted = true;
      });
      return gate.promise;
    });
    const pending = tool.execute(
      "c1",
      { command: "sleep 1" },
      outer.signal,
      undefined,
      ctx,
    );
    hub.request("c1");
    await pending;
    outer.abort();
    gate.resolve(ok(""));
    await tick();
    expect(innerAborted).toBe(false);
  });

  it("未 detach 时外层 abort 照旧传给内层", async () => {
    let innerAborted = false;
    const outer = new AbortController();
    const { tool } = makeHarness(
      (_params, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            innerAborted = true;
            reject(new Error("aborted"));
          });
        }),
    );
    const pending = tool.execute(
      "c1",
      { command: "sleep 99" },
      outer.signal,
      undefined,
      ctx,
    );
    outer.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(innerAborted).toBe(true);
  });

  it("超限时退化为前台等待，返回真实结果", async () => {
    const { tool, manager } = makeHarness(async () => ok("real"));
    for (const id of ["x1", "x2", "x3"]) {
      manager.promote({ ...base, toolCallId: id, startedAt: 0 });
    }
    const result = await tool.execute(
      "c1",
      { command: "npm ci" },
      undefined,
      undefined,
      ctx,
    );
    expect((result as { content: { text: string }[] }).content[0].text).toBe(
      "real",
    );
  });

  it("describeShellResult 取 exit code / 输出 / 落盘路径 / 超时标记", () => {
    expect(
      describeShellResult({
        content: [{ type: "text", text: "boom" }],
        structuredContent: {
          exit_code: 2,
          output: "boom",
          full_output_path: "/tmp/x.log",
        },
      }),
    ).toEqual({
      exitCode: 2,
      output: "boom",
      outputPath: "/tmp/x.log",
      timedOut: false,
    });

    expect(
      describeShellResult(new Error("Command timed out after 1800 seconds")),
    ).toEqual({
      exitCode: null,
      output: "Command timed out after 1800 seconds",
      timedOut: true,
    });
  });

  it("schema 只多一个可选布尔，不动其它字段", () => {
    const [out] = withShellBackground([makeShellTool(async () => ({}))], {
      manager: new BackgroundShellTaskManager({ onEvent: () => undefined }),
      hub: createShellDetachHub(),
      sessionId: "s1",
      cwd: "/tmp",
      strings: { detachedNotice: () => "" },
      onSettled: () => undefined,
    });
    const params = out.parameters as { properties: Record<string, unknown> };
    expect(params.properties.command).toBeDefined();
    expect(params.properties.run_in_background).toMatchObject({
      type: "boolean",
    });
  });
});
