#!/usr/bin/env node
/**
 * 门禁：会话收尾到底会不会回收 stdio MCP 子进程。
 *
 * 正例（本设计要保证的）：AgentSessionRuntime.dispose() → 子进程退出
 * 负例（今天的现状）：AgentSession.dispose()       → 子进程仍在
 * 竞态：连接尚未完成就回收 → 不留残进程
 *
 * 负例必须在正例之前跑，否则这个门禁可能因为「进程本来就不会被杀」而误判通过。
 *
 * 运行：npm run verify:mcp-teardown
 */
import { execFileSync } from "node:child_process";
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  AgentSessionRuntime,
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createMcpExtension,
} from "@earendil-works/pi-coding-agent";

const FIXTURE = path.join(process.cwd(), "scripts/mcp-fixture-server.mjs");

/** 当前活着的 fixture 进程（用命令行匹配；spawn 的是 `electron <fixture>`）。 */
function fixturePids() {
  try {
    return execFileSync("ps", ["-eo", "pid,command"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes(FIXTURE))
      .map((line) => Number(line.trim().split(/\s+/, 1)[0]))
      .filter((pid) => Number.isFinite(pid));
  } catch {
    return [];
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidFile(file, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const pid = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
    await sleep(100);
  }
  return null;
}

async function waitForExit(pid, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await sleep(100);
  }
  return false;
}

/** 真会话 + 真内置 MCP 扩展，配置指向 fixture；不需要配好模型（不调 LLM）。 */
async function makeSession(cwd, agentDir, pidFile) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      createMcpExtension({
        loadConfig: () => ({
          errors: [],
          servers: [
            {
              name: "fixture",
              // McpServerEntry.source 是必填（只有 /mcp 管理器会读它）；连接路径不用，但别缺。
              source: "mcp-teardown-gate",
              config: {
                type: "stdio",
                command: process.execPath,
                args: [FIXTURE],
                env: {
                  ELECTRON_RUN_AS_NODE: "1",
                  DESKWAND_FIXTURE_PID_FILE: pidFile,
                },
              },
            },
          ],
        }),
      }),
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
  });
  await session.bindExtensions({});
  const runtime = new AgentSessionRuntime(
    session,
    { cwd, agentDir },
    () => {
      throw new Error("unused");
    },
    [],
  );
  return { session, runtime };
}

async function main() {
  const baseline = new Set(fixturePids());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-teardown-"));
  const agentDir = path.join(tmp, "agent");
  const cwd = path.join(tmp, "cwd");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  // ── 负例 ───────────────────────────────────────────────────────────────
  const negPidFile = path.join(tmp, "neg.pid");
  const neg = await makeSession(cwd, agentDir, negPidFile);
  const negPid = await waitForPidFile(negPidFile, 20_000);
  if (!negPid) throw new Error("负例：fixture 没起来，门禁无效");
  console.log(`负例：fixture pid=${negPid}`);
  neg.session.dispose();
  await sleep(2_000);
  if (!alive(negPid)) {
    throw new Error(
      "负例失败：session.dispose() 竟然回收了进程 —— 说明这个门禁测不到东西",
    );
  }
  console.log("负例通过：session.dispose() 不回收子进程（= 今天的现状）");
  try {
    process.kill(negPid, "SIGKILL");
  } catch {
    // 已经退出
  }
  if (!(await waitForExit(negPid, 3_000))) {
    throw new Error("负例清理失败：fixture 仍然活着，门禁会自己留孤儿");
  }

  // ── 正例 ───────────────────────────────────────────────────────────────
  const posPidFile = path.join(tmp, "pos.pid");
  const pos = await makeSession(cwd, agentDir, posPidFile);
  const posPid = await waitForPidFile(posPidFile, 20_000);
  if (!posPid) throw new Error("正例：fixture 没起来");
  // pid 文件在 fixture 启动时写下，此时 initialize 未必完成；等一拍，
  // 好让这个正例真的测「已连接 → dispose」，而不是又在测竞态。
  await sleep(1_000);
  console.log(`正例：fixture pid=${posPid}（关闭前存活=${alive(posPid)}）`);
  await pos.runtime.dispose();
  if (!(await waitForExit(posPid, 3_000))) {
    throw new Error("正例失败：runtime.dispose() 之后子进程仍然活着");
  }
  console.log("正例通过：runtime.dispose() → 子进程已退出");

  // ── 竞态：连接未完成就回收 ──────────────────────────────────────────────
  const racePidFile = path.join(tmp, "race.pid");
  const race = await makeSession(cwd, agentDir, racePidFile);
  await race.runtime.dispose(); // 不等连接完成
  // 「pid 文件没出现」不能直接当作「没 spawn」：spawn 可能比我们看得更晚。
  // 所以先在 3s 窗口里找，没找到再等 3s 复看一次：只要它出现过，就必须自己退。
  let racePid = await waitForPidFile(racePidFile, 3_000);
  if (!racePid) {
    await sleep(3_000);
    racePid = await waitForPidFile(racePidFile, 200);
  }
  if (racePid) {
    if (!(await waitForExit(racePid, 3_000))) {
      throw new Error("竞态失败：连接中的会话被回收后仍有残留进程");
    }
    console.log("竞态通过：连接中回收，已起来的进程随后退出");
  } else {
    console.log("竞态通过：连接未完成即被取消，无进程残留");
  }

  // ── 自证：本门禁自己不能留孤儿 ────────────────────────────────────────
  // 单次 `ps` 计数或「pid 文件没出现」都不足以证明没留进程（spawn 可能比我们看得晚）。
  // 所以：与本脚本启动时的基线对比，任何**新增**的 fixture 进程必须在 5s 内消失。
  let leaked = [];
  for (let i = 0; i < 25; i += 1) {
    leaked = fixturePids().filter((pid) => !baseline.has(pid));
    if (leaked.length === 0) break;
    await sleep(200);
  }
  if (leaked.length > 0) {
    throw new Error(`门禁留下孤儿进程：${leaked.join(", ")}`);
  }
  console.log("自证通过：无新增 fixture 进程存活");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("TEARDOWN OK");
}

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error("TEARDOWN FAILED:", error);
      app.exit(1);
    },
  );
