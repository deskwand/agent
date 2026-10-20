/**
 * pi-subagents 补丁的「补丁面 + 消费方契约」检查。
 *
 * 边界说明（诚实记录本检查覆盖到什么、不覆盖什么）：
 *
 * 覆盖：
 *  1. 我们的补丁面仍在（`listAgents` 暴露、每次激活登记的 registry list、
 *     前台 record 的 `toolCallId`）—— 它同时是我们与 `session-tap.ts` 之间的契约：
 *     那两处字面量必须保持同步，漂了就说明补丁被重生成成了别的形状。
 *  2. **宿主侧的前提仍在**：该包自己的 `AgentManager.listAgents()` 声明、以及
 *     上游自身的多处 `manager.listAgents()` 调用点。这些与我们的补丁无关，
 *     所以能独立于「补丁是否应用」而失败 —— 如果上游把该方法改名/移除，
 *     我们插入的那行调用会在运行期炸，而这些断言会先红。
 *
 * 不覆盖：
 *  - 真正的运行期激活（需要 pi 会话 + 一个真实 spawn 的子代理）。那由打包版
 *    人工回归清单里的「子代理」一项承担。
 *  - `record` 对象是否被冻结/不可扩展这类运行期特性。静态读文件看不见。
 *
 * 「补丁 hunk 能干净应用」只证明该包文件未变，不证明 0.99.1 宿主仍满足补丁的
 * 假设（design §3.2 / §4.5 R11）—— 下面第 2 组断言就是为这一条加的。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "node_modules/@tintinweb/pi-subagents/dist");

function read(relative: string): string {
  return readFileSync(join(DIST, relative), "utf8");
}

describe("pi-subagents 0.19.0 patch surfaces survive on the 0.99.1 host", () => {
  const index = read("index.js");

  it("exposes listAgents on the manager registry entry", () => {
    expect(index).toContain("listAgents: () => manager.listAgents()");
  });

  it("keeps the per-activation registry list used for toolCallId pairing", () => {
    expect(index).toContain('Symbol.for("pi-subagents:manager-list")');
    expect(index).toContain("registryList.add(registryEntry)");
    expect(index).toContain("registryList.delete(registryEntry)");
  });

  it("still records toolCallId on foreground records", () => {
    expect(index).toContain("if (fgRec) fgRec.toolCallId = toolCallId");
  });

  // 「子代理结果被 TTL 清掉后还能取回」那组修复的补丁面。行为正确性由
  // pi-subagents-result-history-runtime.test.ts 用真实工厂证明；这里只保证
  // 补丁没有在重生成时丢掉任一处接线（丢了就是静默退回「Agent not found」）。
  const patchText = readFileSync(
    join(process.cwd(), "patches/@tintinweb+pi-subagents+0.19.0.patch"),
    "utf8",
  );

  it("keeps the persisted-result fallback wired into get_subagent_result", () => {
    expect(index).toContain(
      'import { findHistoricalResult, formatHistoricalResult } from "./result-history.js"',
    );
    expect(index).toContain(
      "findHistoricalResult(ctx.sessionManager.getEntries(), params.agent_id)",
    );
    expect(index).toContain(
      "return textResult(formatHistoricalResult(historical, params.verbose))",
    );
  });

  it("keeps every settle path writing the session snapshot", () => {
    expect(index).toContain("function persistAgentResult(record) {");
    expect(index).toContain("persistAgentResult(record);");
    // 前台 resume 由 AgentManager 就地 settle，不触发完成回调，所以它必须自己
    // 落盘；同时先写启动屏障，避免退回上一次运行的答案。
    expect(index).toContain(
      "startForegroundResume(manager, pi, existing, params, signal)",
    );
    expect(index).toContain('piRef.appendEntry("subagents:result-state"');
    expect(index).toContain(
      'pi.appendEntry("subagents:result-state", { id, status: "queued" })',
    );
  });

  // 上面两组同时要落在**补丁文本**里：本地 node_modules 是打过补丁的，光查它
  // 无法发现「重生成时丢了 index.js 的 hunk」——那种情况下干净安装会静默回到
  // 没有回退的版本。
  it("the patch text carries the entry-point wiring, not just the helper files", () => {
    for (const wiring of [
      'import { findHistoricalResult, formatHistoricalResult } from "./result-history.js"',
      "findHistoricalResult(ctx.sessionManager.getEntries(), params.agent_id)",
      "function persistAgentResult(record) {",
      "startForegroundResume(manager, pi, existing, params, signal)",
      'piRef.appendEntry("subagents:result-state"',
      'pi.appendEntry("subagents:result-state", { id, status: "queued" })',
    ]) {
      expect(patchText, `补丁缺少接线：${wiring}`).toContain(wiring);
    }
  });
});

describe("pi-subagents host-side assumptions still hold (independent of our patch)", () => {
  it("AgentManager still declares listAgents()", () => {
    const manager = read("agent-manager.js");
    expect(manager).toContain("listAgents() {");
    // 类型声明侧同样在，说明它不是内部实现细节而是公开面。
    expect(read("agent-manager.d.ts")).toContain(
      "listAgents(): AgentRecord[];",
    );
  });

  it("the package itself still calls manager.listAgents()", () => {
    // 上游自己的调用点与我们插入的那行互不相干 —— 它们存在，就说明这个方法
    // 在 0.99.1 宿主上仍是活的公开面，而不是只被我们的补丁悬空引用。
    for (const file of [
      "index.js",
      "ui/agent-widget.js",
      "ui/agent-mention.js",
      "ui/fleet-list.js",
    ]) {
      expect(read(file), `${file} 不再调用 manager.listAgents()`).toContain(
        "manager.listAgents()",
      );
    }
  });

  it("the history helper ships with the patch, not only in this checkout", () => {
    // 补丁面：干净安装后 helper 必须真的被 patch-package 写进 dist，
    // 否则入口 import 会在运行期抛 ERR_MODULE_NOT_FOUND。
    const patch = readFileSync(
      join(process.cwd(), "patches/@tintinweb+pi-subagents+0.19.0.patch"),
      "utf8",
    );
    for (const file of ["result-history.js", "result-history.d.ts"]) {
      expect(patch, `${file} 不在补丁里`).toContain(
        `b/node_modules/@tintinweb/pi-subagents/dist/${file}`,
      );
    }
  });
});
