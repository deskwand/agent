/**
 * 真实扩展的测试 harness —— 只在独立 Node 进程里使用（见
 * pi-subagents-result-history-runtime.test.ts）。
 *
 * 为什么不用 vi.mock：要验证的是「实际的 GET_RESULT execute 在 live 记录被
 * cleanup 删掉之后仍然能取回结果」，所以工厂、工具、真实 AgentManager 都必须
 * 是产品那份实现。Vitest 当前配置把第三方包放在 externalize 一侧，拦截其内部
 * 构造不可靠；这里改为在 Node 进程内短暂包装一个原型方法，捕获真实实例后立刻
 * 还原原型。断言失败即抛错，不会留下未捕获状态。
 *
 * 这里显式列出 API double（不做「未知属性一律 noop」的 Proxy），这样上游新增
 * 依赖会在这里暴露，而不是被悄悄吞掉。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const noop = () => {};

export async function createHarness(root) {
  const dir = mkdtempSync(join(tmpdir(), "subagent-result-test-"));
  const oldCwd = process.cwd();
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;

  const load = (relative) => import(pathToFileURL(join(root, relative)).href);
  const { AgentManager } = await load(
    "node_modules/@tintinweb/pi-subagents/dist/agent-manager.js",
  );
  const { default: factory } = await load(
    "node_modules/@tintinweb/pi-subagents/dist/index.js",
  );
  const { createEventBus, SessionManager } = await load(
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
  );

  const handlers = new Map();
  const tools = new Map();
  let parent = SessionManager.inMemory();
  let manager;

  const ui = { notify: noop, setWidget: noop, setStatus: noop };
  const ctx = () => ({
    hasUI: false,
    ui,
    cwd: dir,
    sessionManager: parent,
    model: undefined,
    modelRegistry: { getAvailable: () => [], getAll: () => [] },
  });

  const pi = {
    on: (name, fn) => {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
      return noop;
    },
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: noop,
    registerFlag: noop,
    registerEntryRenderer: noop,
    registerMessageRenderer: noop,
    getFlag: () => undefined,
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools: noop,
    sendMessage: noop,
    events: createEventBus(),
    appendEntry: (customType, data) =>
      parent.appendCustomEntry(customType, data),
  };

  const close = async () => {
    try {
      for (const fn of handlers.get("session_shutdown") ?? [])
        await fn({ type: "session_shutdown", reason: "quit" }, ctx());
    } finally {
      process.chdir(oldCwd);
      if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = oldDir;
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const key = Symbol.for("pi-subagents:manager-list");
  const before = new Set(globalThis[key] ?? []);
  const original = AgentManager.prototype.getRecord;
  const capture = (candidate) => {
    manager = candidate;
  };
  process.chdir(dir);
  try {
    AgentManager.prototype.getRecord = function (id) {
      capture(this);
      return original.call(this, id);
    };
    factory(pi);
    const entry = [...globalThis[key]].find((item) => !before.has(item));
    assert.ok(entry, "this activation's registry entry");
    // 真实产品入口会调用 getRecord；用一次探针查询把真实实例捕获下来。
    entry.getRecord("fixture-probe");
    assert.ok(manager instanceof AgentManager, "capture a real manager");
  } catch (error) {
    await close();
    throw error;
  } finally {
    AgentManager.prototype.getRecord = original;
  }

  return {
    manager,
    tools,
    SessionManager,
    get parent() {
      return parent;
    },
    setParent: (next) => {
      parent = next;
    },
    execute: (name, input) =>
      tools
        .get(name)
        .execute(
          "fixture-call",
          input,
          new AbortController().signal,
          undefined,
          ctx(),
        ),
    close,
  };
}
