/**
 * @module main/engine/engine-supervisor
 *
 * 「最佳音质」档引擎子进程的管家：起停 / 空闲端口 / 健康检查 / 崩溃退避 /
 * 空闲回收 / 退出清理。
 *
 * 三个刻意的设计：
 *
 * 1. **只监听 127.0.0.1**，端口每次现取（先 bind :0 再释放）。不写死 8080：
 *    用户机器上那端口很可能被占，而"起不来"要比"换个端口"难查得多。
 * 2. **空闲 10 分钟就 kill**。它常驻 2.7GB —— 用户没说十句话却要一直占着，
 *    是这个方案最容易被骂的地方。下次说话热启动 0.5–0.8s，代价可接受。
 * 3. **崩溃退避而不是死等**：崩过之后 `ensureReady()` 在退避窗口内直接返回失败，
 *    让调用方回退到「均衡」档出声（有声音、稍差），而不是让用户干等 20 秒。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { app } from "electron";
import { readRuntimeSpec } from "../speech/runtime-spec";
import { enginePaths } from "./engine-installer";
import { log, logError } from "../utils/logger";

export type EngineStatus = "stopped" | "starting" | "ready" | "failed";

export interface EngineSupervisor {
  status(): EngineStatus;
  ensureReady(): Promise<
    { ok: true; port: number } | { ok: false; error: string }
  >;
  /** 每次请求后调用：重置空闲回收计时器（桥接层在收到第一块时调）。 */
  touch(): void;
  stop(): void;
  /** 仅供桥接层用：当前端口；未就绪时为 null。 */
  port(): number | null;
  /** 清掉崩溃计数与 failed（安装/重试/预热前调用）。 */
  reset(): void;
}

/** 崩溃后的退避阶梯：第 1、2 次重启各等这么久。 */
const BACKOFF_MS = [1_000, 5_000];
/** 一个健康周期内崩到第 3 次就置 failed，不再自动重启。 */
const MAX_CRASHES = 3;
/**
 * 活过 1 分钟就算"这次是健康的"，崩溃计数重新开始。
 *
 * 为什么不在启动成功时清零：**起得来但一说话就崩**是最需要被拦住的那种坏。
 * 清零等于每次都能重来，用户每句话都要等一次"启动 → 崩 → 再来"，永远等不到兜底。
 */
const HEALTHY_UPTIME_MS = 60_000;
const IDLE_MS = 10 * 60 * 1000;
/** 冷启动实测 19.8s（Metal kernel 编译），Windows 首扫还要更久 —— 给足余量。 */
const READY_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 200;

/** 先 bind :0 取一个空闲端口再释放。 */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createEngineSupervisor(deps: {
  paths: { bin: string; talker: string; tokenizer: string };
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}): EngineSupervisor {
  const doSpawn = deps.spawn ?? spawn;
  const doFetch = deps.fetch ?? fetch;
  const write = deps.log ?? ((message: string) => log(message));
  const writeError =
    deps.logError ??
    ((message: string, error: unknown) => logError(message, error));

  let child: ChildProcess | null = null;
  let status: EngineStatus = "stopped";
  let currentPort: number | null = null;
  let crashes = 0;
  let lastCrashAt = 0;
  let startedAt = 0;
  let stopping = false;
  /** spawn 失败的原始信息（ENOENT / EACCES）：它不走 exit，得单独记。 */
  let startupError: string | null = null;
  let idle: NodeJS.Timeout | null = null;
  let pending: Promise<
    { ok: true; port: number } | { ok: false; error: string }
  > | null = null;

  const clearIdle = () => {
    if (idle) clearTimeout(idle);
    idle = null;
  };

  /** 空闲回收：到期 kill 并把状态置回 stopped。 */
  const armIdle = () => {
    clearIdle();
    idle = setTimeout(() => {
      write("[TtsEngine] idle for 10 minutes, releasing memory");
      stop();
    }, IDLE_MS);
    // 定时器不该拖住进程退出
    idle.unref?.();
  };

  const stop = () => {
    clearIdle();
    const proc = child;
    child = null;
    currentPort = null;
    if (status !== "failed") status = "stopped";
    if (!proc) return;
    stopping = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // 已经死了
    }
  };

  const onExit = (code: number | null) => {
    child = null;
    currentPort = null;
    clearIdle();
    if (stopping) {
      stopping = false;
      return;
    }
    // 非主动停止 = 崩了。活够久的算新的一轮，秒崩的累加 —— 让 ensureReady 走退避。
    const uptime = startedAt ? Date.now() - startedAt : 0;
    crashes = uptime > HEALTHY_UPTIME_MS ? 1 : crashes + 1;
    lastCrashAt = Date.now();
    if (crashes >= MAX_CRASHES) {
      status = "failed";
      writeError(`[TtsEngine] crashed ${crashes} times, giving up`, code);
      return;
    }
    status = "stopped";
    writeError(`[TtsEngine] exited unexpectedly (code ${code})`, code);
  };

  const start = async (): Promise<
    { ok: true; port: number } | { ok: false; error: string }
  > => {
    status = "starting";
    startupError = null; // 上一次的失败信息不带到这一次
    const port = await freePort();
    let proc: ChildProcess;
    try {
      proc = doSpawn(
        deps.paths.bin,
        [
          "--model",
          deps.paths.talker,
          "--codec",
          deps.paths.tokenizer,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--lang",
          "chinese",
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
    } catch (error) {
      status = "stopped";
      return { ok: false, error: `spawn failed: ${String(error)}` };
    }
    child = proc;
    currentPort = port;
    stopping = false;
    startedAt = Date.now();
    // 起进程的实参进日志：端口是现取的，"起不来"时第一个要看的就是它
    write(
      `[TtsEngine] started pid=${proc.pid ?? "-"} on 127.0.0.1:${port} (${deps.paths.bin})`,
    );
    // stdio 是 Buffer，默认按 UTF-8 解 —— Windows 上也够（引擎只输出 ASCII 日志）
    proc.stdout?.on("data", (bytes: Buffer) =>
      write(`[TtsEngine] ${bytes.toString("utf8").trim()}`),
    );
    proc.stderr?.on("data", (bytes: Buffer) =>
      write(`[TtsEngine] ${bytes.toString("utf8").trim()}`),
    );
    proc.on("exit", (code) => onExit(code));
    proc.on("error", (error: Error) => {
      // spawn 失败（二进制不在、没有执行权限）走这里。它**不发 exit**：
      // 只听 exit 的后果是吞掉一个未捕获异常、还要白等满 180 秒 ——
      // 用户那边看到的就是"语音卡死三分钟"。
      startupError = error.message;
      writeError(`[TtsEngine] failed to start: ${error.message}`, error);
      child = null;
      currentPort = null;
      crashes += 1;
      lastCrashAt = Date.now();
      status = crashes >= MAX_CRASHES ? "failed" : "stopped";
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!child) {
        return {
          ok: false,
          error: startupError ?? "engine exited during startup",
        };
      }
      try {
        const res = await doFetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) {
          status = "ready";
          armIdle();
          return { ok: true, port };
        }
      } catch {
        // 还没起来
      }
      await sleep(HEALTH_POLL_MS);
    }
    writeError("[TtsEngine] health check timed out", port);
    stop();
    status = "failed";
    return { ok: false, error: "engine health timeout" };
  };

  const ensureReady = async (): Promise<
    { ok: true; port: number } | { ok: false; error: string }
  > => {
    if (status === "failed") return { ok: false, error: "engine unavailable" };
    if (status === "ready" && currentPort) {
      return { ok: true as const, port: currentPort };
    }
    // 退避窗口内不重试：调用方会回退「均衡」出声，比让用户干等更久好
    if (crashes > 0) {
      const wait = BACKOFF_MS[Math.min(crashes - 1, BACKOFF_MS.length - 1)];
      if (Date.now() - lastCrashAt < wait) {
        return { ok: false as const, error: "engine restarting" };
      }
    }
    // 并发调用只起一次进程
    if (!pending) {
      pending = start().finally(() => {
        pending = null;
      });
    }
    return await pending;
  };

  return {
    status: () => status,
    ensureReady,
    touch: () => {
      if (status === "ready") armIdle();
    },
    stop,
    port: () => (status === "ready" ? currentPort : null),
    reset: () => {
      crashes = 0;
      lastCrashAt = 0;
      if (status === "failed") status = "stopped";
    },
  };
}

let singleton: EngineSupervisor | null = null;

/**
 * 单实例。引擎目录取自随包清单：没装或清单没这一项时**抛错** —— 调用方
 * （桥接层）在此之前已经判过可用性，走到这里说明是接线错了。
 */
export function getEngineSupervisor(): EngineSupervisor {
  if (singleton) return singleton;
  const spec = readRuntimeSpec().ttsEngine;
  if (!spec) throw new Error("engine not published in manifest");
  const paths = enginePaths(app.getPath("userData"), spec);
  singleton = createEngineSupervisor({
    paths,
    log: (message) => log(message),
    logError: (message, error) => logError(message, error),
  });
  return singleton;
}

/** 退出清理：主进程 before-quit 调它，别把 2.7GB 的进程留在用户机器上。 */
export function disposeEngineSupervisor(): void {
  singleton?.stop();
  singleton = null;
}
