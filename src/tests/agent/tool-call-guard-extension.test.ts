import { describe, expect, it, vi } from "vitest";
import { createToolCallGuardExtension } from "../../main/agent/tool-call-guard-extension";
import type { ToolCallGuard } from "../../main/extensions/agent-runtime-extension";
import type { AskUserResult } from "../../shared/ask-user";

vi.mock("../../main/utils/logger", () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

type Handler = (event: Record<string, unknown>) => Promise<unknown>;

function install(
  getGuard: () => ToolCallGuard | undefined,
  requestAskUser?: Parameters<typeof createToolCallGuardExtension>[1],
): Handler {
  let handler: Handler | undefined;
  const pi = {
    on: (name: string, fn: Handler) => {
      if (name === "tool_call") handler = fn;
    },
  };
  (
    createToolCallGuardExtension(getGuard, requestAskUser) as never as (
      pi: unknown,
    ) => void
  )(pi);
  if (!handler) throw new Error("no tool_call handler");
  return handler;
}

const ask = [{ question: "ok?", header: "h", type: "text" }] as never;

describe("createToolCallGuardExtension", () => {
  it("returns the guard's block", async () => {
    const h = install(() => async () => ({ block: true, reason: "no" }));
    expect(await h({ toolName: "bash", toolCallId: "1", input: {} })).toEqual({
      block: true,
      reason: "no",
    });
  });

  it("allows when no guard or guard allows", async () => {
    expect(
      await install(() => undefined)({
        toolName: "bash",
        toolCallId: "1",
        input: {},
      }),
    ).toBeUndefined();
    expect(
      await install(() => async () => undefined)({
        toolName: "bash",
        toolCallId: "1",
        input: {},
      }),
    ).toBeUndefined();
  });

  it("blocks with a fixed reason when the guard throws", async () => {
    const h = install(() => async () => {
      throw new Error("boom");
    });
    expect(await h({ toolName: "bash", toolCallId: "1", input: {} })).toEqual({
      block: true,
      reason:
        "Blocked: the safety check failed. Do not retry this action; report it to the user.",
    });
  });

  it("uses a guard-prefixed card id keyed on the call itself", async () => {
    const requestAskUser = vi.fn(
      async () => ({ answers: [] }) as unknown as AskUserResult,
    );
    const h = install(
      () => async (_c, ctx) => {
        await ctx.askUser?.(ask);
        return undefined;
      },
      requestAskUser,
    );
    await h({
      toolName: "x",
      toolCallId: "p/1",
      parentToolCallId: "p",
      input: {},
    });
    expect(requestAskUser).toHaveBeenCalledWith("guard:p/1", ask);
  });

  it("serializes asks across concurrent calls", async () => {
    const releases: Array<() => void> = [];
    const requestAskUser = vi.fn(
      () =>
        new Promise<AskUserResult>((resolve) => {
          releases.push(() => resolve({} as AskUserResult));
        }),
    );
    const h = install(
      () => async (_c, ctx) => {
        await ctx.askUser?.(ask);
        return undefined;
      },
      requestAskUser,
    );
    const a = h({ toolName: "x", toolCallId: "1", input: {} });
    const b = h({ toolName: "x", toolCallId: "2", input: {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(requestAskUser).toHaveBeenCalledTimes(1);
    releases[0]();
    await new Promise((r) => setTimeout(r, 10));
    expect(requestAskUser).toHaveBeenCalledTimes(2);
    releases[1]();
    await Promise.all([a, b]);
  });

  it("omits askUser when requestAskUser is unavailable", async () => {
    let seen: unknown = "unset";
    const h = install(() => async (_c, ctx) => {
      seen = ctx.askUser;
      return undefined;
    });
    await h({ toolName: "x", toolCallId: "1", input: {} });
    expect(seen).toBeUndefined();
  });
});
