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
});
