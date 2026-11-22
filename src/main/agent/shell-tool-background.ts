/**
 * @module main/agent/shell-tool-background
 *
 * 把 bash / powershell 的执行变成「可以被甩到后台」的：
 * - 开始前把 timeout 抬到 BACKGROUND_MAX_SECONDS（pi 自带 timeout 到点会 kill 子进程，
 *   事后延长不了），前台时限由本层自己的定时器负责；
 * - detach 先到就返回合成结果，底层 promise 继续跑，结算交给任务管理器；
 * - detach 之后切断外层 abort 转发，进程活到自然结束。
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ShellTask, ShellToolName } from "../../shared/shell-task";
import type { BackgroundShellTaskManager } from "./background-shell-task-manager";

/** 交给 pi 的超时上限（秒）。任务管理器另有 30 分钟兜底。 */
export const BACKGROUND_MAX_SECONDS = 1800;

/** 模型没给 timeout 时的前台上限（秒），与 wrapBashToolWithDefaultTimeout 一致。 */
export const FOREGROUND_DEFAULT_SECONDS = 120;

/**
 * detach 之后给内部执行的一个宽限期：这期间就跑完的命令不该被报成「已转后台」。
 * 真实终端命令通常几毫秒到几百毫秒，300ms 足以覆盖「秒回」那一类。
 */
const FAST_PATH_GRACE_MS = 300;

/**
 * 传给 pi 的 timeout 是后台上限（1800s），而前台上限要小得多。
 * 下游包装（sudo 拦截）看到的 timeout 因此不能直接当前台上限用 ——
 * 用这个函数把它折回前台语义。
 */
export function foregroundSecondsFor(timeout: number | undefined): number {
  if (timeout == null) return FOREGROUND_DEFAULT_SECONDS;
  return timeout >= BACKGROUND_MAX_SECONDS
    ? FOREGROUND_DEFAULT_SECONDS
    : timeout;
}

const SHELL_TOOLS = new Set<ShellToolName>(["bash", "powershell"]);

export interface ShellDetachHub {
  /** 登记本 call 的 detach 回调；返回注销函数。 */
  hold(toolCallId: string, onDetach: () => void): () => void;
  /** 外部（IPC）要求把这次调用转后台。返回 false = 该调用不在跑。 */
  request(toolCallId: string): boolean;
}

export function createShellDetachHub(): ShellDetachHub {
  const held = new Map<string, () => void>();
  return {
    hold(toolCallId, onDetach) {
      held.set(toolCallId, onDetach);
      return () => {
        if (held.get(toolCallId) === onDetach) held.delete(toolCallId);
      };
    },
    request(toolCallId) {
      const fn = held.get(toolCallId);
      if (!fn) return false;
      fn();
      return true;
    },
  };
}

export interface ShellBackgroundStrings {
  detachedNotice: (taskId: string, command: string) => string;
}

export interface ShellBackgroundDeps {
  manager: BackgroundShellTaskManager;
  hub: ShellDetachHub;
  sessionId: string;
  cwd: string;
  strings: ShellBackgroundStrings;
  onSettled: (task: ShellTask) => void;
}

interface ShellParams {
  command?: string;
  timeout?: number;
  run_in_background?: boolean;
}

interface ShellResultShape {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: {
    output?: string;
    full_output_path?: string;
    exit_code?: number;
  };
}

export function describeShellResult(result: unknown): {
  exitCode: number | null;
  output: string;
  outputPath?: string;
  timedOut?: boolean;
} {
  if (result instanceof Error) {
    return {
      exitCode: null,
      output: result.message,
      timedOut: /timed out after/i.test(result.message),
    };
  }
  const shape = (result ?? {}) as ShellResultShape;
  const text = (shape.content ?? []).map((part) => part?.text ?? "").join("");
  const structured = shape.structuredContent;
  return {
    exitCode:
      typeof structured?.exit_code === "number" ? structured.exit_code : null,
    output: structured?.output ?? text,
    outputPath: structured?.full_output_path,
    timedOut: false,
  };
}

export function withShellBackground(
  tools: ToolDefinition[],
  deps: ShellBackgroundDeps,
): ToolDefinition[] {
  return tools.map((tool) => {
    const toolName = tool.name as ShellToolName;
    if (!SHELL_TOOLS.has(toolName)) return tool;

    const originalExecute = tool.execute;
    const schema = tool.parameters as unknown as {
      properties?: Record<string, unknown>;
    };

    return {
      ...tool,
      // 只摊开再加一个属性：不重新构造 schema（typebox 版本差异会吞掉 optional）
      parameters: {
        ...(tool.parameters as unknown as object),
        properties: {
          ...(schema.properties ?? {}),
          run_in_background: {
            type: "boolean",
            description:
              "Run this long command in the background and return immediately. Use only for commands that clearly take minutes (installing dependencies, full test suites, builds). Never for short commands.",
          },
        },
      },
      execute: async (
        toolCallId: string,
        rawParams: unknown,
        signal: AbortSignal | undefined,
        onUpdate: ((update: unknown) => void) | undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: any,
      ) => {
        const startedAt = Date.now();
        const params = rawParams as ShellParams;
        const wantsBackground = params.run_in_background === true;

        const inner = new AbortController();
        let detached = false;

        let resolveDetach: () => void = () => undefined;
        const detachPromise = new Promise<"detach">((resolve) => {
          resolveDetach = () => resolve("detach");
        });

        // 前台时限：模型给的（已含 120 默认）或 120；到点且未 detach 才 abort
        const foregroundTimer = setTimeout(
          () => inner.abort(),
          (params.timeout ?? FOREGROUND_DEFAULT_SECONDS) * 1000,
        );
        foregroundTimer.unref?.();

        let releaseHub: () => void = () => undefined;
        const detach = () => {
          detached = true;
          clearTimeout(foregroundTimer);
          resolveDetach();
        };

        const forwardAbort = () => {
          if (!detached) inner.abort();
        };
        if (signal) {
          if (signal.aborted) forwardAbort();
          else signal.addEventListener("abort", forwardAbort, { once: true });
        }

        if (wantsBackground) detach();
        else releaseHub = deps.hub.hold(toolCallId, detach);

        const innerPromise = originalExecute(
          toolCallId,
          { ...params, timeout: BACKGROUND_MAX_SECONDS },
          inner.signal,
          onUpdate
            ? (update: unknown) => {
                const shape = update as ShellResultShape;
                const snapshot = (shape.content ?? [])
                  .map((part) => part?.text ?? "")
                  .join("");
                deps.manager.setTail(deps.sessionId, toolCallId, snapshot);
                onUpdate(update);
              }
            : undefined,
          ctx,
        );

        // 只建一次，race 与后续结算共用（Promise 可以接多个 then）
        const innerOutcome = innerPromise.then(
          (result) => ({ kind: "done" as const, result }),
          (error: unknown) => ({ kind: "error" as const, error }),
        );

        const first = await Promise.race([
          innerOutcome,
          detachPromise.then(() => ({ kind: "detach" as const })),
        ]);

        clearTimeout(foregroundTimer);
        releaseHub();

        if (first.kind !== "detach") {
          if (first.kind === "error") throw first.error;
          return first.result;
        }

        // 宽限期：detach 之后很快就跑完的命令照旧回真实结果，不制造一条后台任务
        const fastPath = await Promise.race([
          innerOutcome,
          new Promise<"grace">((resolve) =>
            setTimeout(() => resolve("grace"), FAST_PATH_GRACE_MS).unref?.(),
          ),
        ]);
        if (fastPath !== "grace") {
          if (fastPath.kind === "error") throw fastPath.error;
          return fastPath.result;
        }

        const promoted = deps.manager.promote({
          sessionId: deps.sessionId,
          toolCallId,
          toolName,
          command: typeof params.command === "string" ? params.command : "",
          cwd: deps.cwd,
          startedAt,
          kill: () => inner.abort(),
        });

        if (!promoted) {
          // 超限：退化成前台等待 —— 必须把前台语义还回来，否则这一轮既没有
          // 前台超时（pi 那边是 1800s）也收不到 Esc 的中止信号。
          detached = false;
          const restoreTimer = setTimeout(
            () => inner.abort(),
            foregroundSecondsFor(params.timeout) * 1000,
          );
          restoreTimer.unref?.();
          try {
            return await innerPromise;
          } finally {
            clearTimeout(restoreTimer);
          }
        }

        const finish = (settled: ShellTask | null) => {
          // settle 因重复结算返回 null 时不要再回填一次
          if (settled) deps.onSettled(settled);
        };
        innerPromise.then(
          (result) => {
            const described = describeShellResult(result);
            finish(
              deps.manager.settle(deps.sessionId, toolCallId, {
                exitCode: described.exitCode,
                output: described.output,
                outputPath: described.outputPath,
                timedOut: described.timedOut,
              }),
            );
          },
          (error: unknown) => {
            const described = describeShellResult(error);
            finish(
              deps.manager.settle(deps.sessionId, toolCallId, {
                exitCode: described.exitCode,
                output: described.output,
                timedOut: described.timedOut,
              }),
            );
          },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: deps.strings.detachedNotice(promoted.id, promoted.command),
            },
          ],
          details: undefined as unknown,
        };
      },
    } as ToolDefinition;
  });
}
