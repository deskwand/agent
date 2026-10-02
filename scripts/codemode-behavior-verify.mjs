/**
 * MCP + codemode 行为验证（Electron 无头）。
 *
 * vitest 里做不了这件事：MCP 扩展的建连链在 node/vitest 环境跑不通（异常被上游的
 * `ctx.ui.notify` try/catch 吞掉）。Electron 里可以 —— 早先的 pi-mcp spike 已证明这点。
 *
 * 验四件事（都是这次行为变更的核心，且没有任何自动化门禁覆盖）：
 *  1. 配了 MCP server（**不写 exposure**）后，codemode 是否被**派生激活**
 *     （上游 `ensureDiscoveryActive`，需要 server 真连上）
 *  2. MCP 工具是否**从模型声明里消失**（不再是 `direct`）
 *  3. 它是否仍然**可调用**（`getCallableToolNames()`）
 *  4. **真跑一段 codemode 脚本去调那个 MCP 工具** —— 覆盖 worker + wasm + 传输整条链
 *  5. `mcp.json` 顶层写 `autoEnableCodemode: false` 时，codemode **不**激活
 *
 * 用的是 SDK 默认配置（`createMcpExtension()` 不传 options），与生产一致。
 */
import pkg from "electron";
const { app } = pkg;
import * as fs from "node:fs";
import { writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const FIXTURE = path.join(process.cwd(), "scripts/mcp-fixture-server.mjs");

function makeEnv(extraTopLevel = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "codemode-verify-"));
  const project = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        // 不写 exposure ⇒ 取上游默认 codemode（今回改动要达到的状态）
        Fixture: {
          type: "stdio",
          command: process.execPath,
          args: [FIXTURE],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
      ...extraTopLevel,
    }),
  );
  return { project, agentDir };
}

async function buildSession(agentDir, project) {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const loader = new sdk.DefaultResourceLoader({
    cwd: project,
    agentDir,
    settingsManager: sdk.SettingsManager.inMemory({}),
    extensionFactories: [
      sdk.createMcpExtension(), // 默认 loadConfig ⇒ 读 agentDir/mcp.json
      sdk.createCodemodeExtension(), // 不传 models/mode ⇒ 跟随上游默认
    ],
  });
  await loader.reload();
  const { session } = await sdk.createAgentSession({
    cwd: project,
    agentDir,
    resourceLoader: loader,
  });
  return session;
}

async function waitFor(predicate, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`  (timeout waiting for ${label})`);
  return false;
}

async function main() {
  const out = { cases: {} };

  // ── 用例 A：默认（不写 exposure）
  {
    const { project, agentDir } = makeEnv();
    const session = await buildSession(agentDir, project);
    const caseA = {};
    caseA.codemodeActivated = await waitFor(
      () => session.getActiveToolNames().includes("codemode"),
      20000,
      "codemode activation",
    );
    caseA.activeTools = session.getActiveToolNames();
    caseA.callableHasFixture = session
      .getCallableToolNames()
      .includes("mcp__Fixture__echo");
    caseA.declaredHasFixture = session
      .getActiveToolNames()
      .includes("mcp__Fixture__echo");

    // 真跑脚本：沙箱里调 MCP 工具
    if (caseA.codemodeActivated) {
      try {
        const def = session.getToolDefinition("codemode");
        const res = await def.execute(
          {
            code: 'const r = await tools.mcp__Fixture__echo({ text: "hi" });\nreturn r;',
          },
          {},
        );
        caseA.scriptResult = JSON.stringify(res).slice(0, 400);
      } catch (error) {
        caseA.scriptError = String(error).slice(0, 400);
      }
    }
    out.cases.default = caseA;
  }

  // ── 用例 B：mcp.json 顶层 autoEnableCodemode: false（pi 的全局 opt-out，本次改为透传）
  {
    const { project, agentDir } = makeEnv({ autoEnableCodemode: false });
    const session = await buildSession(agentDir, project);
    // 给它一点时间，确认它**始终**不激活
    await new Promise((r) => setTimeout(r, 8000));
    out.cases.optOut = {
      activeTools: session.getActiveToolNames(),
      codemodeActivated: session.getActiveToolNames().includes("codemode"),
    };
  }

  writeFileSync("/tmp/codemode-verify.json", JSON.stringify(out, null, 2));
  console.log("VERIFY DONE");
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error("VERIFY ERROR:", error);
    app.exit(1);
  },
);
