import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

/**
 * **接线守卫**（不是行为断言）。
 *
 * 行为由 `external-skill-policy.test.ts`（策略）与 `external-skills-source.test.ts`
 * （来源与开关）覆盖。这里守的是两个"改了却没人发现"的接线点：
 *  1. `DefaultResourceLoader` 在本仓有**两个**构造点（host 构造 + 会话级派生），
 *     漏掉任何一个都会让第三方默认关只在部分会话生效；
 *  2. 启动空跑一旦被删，技能页在首个会话之前就没有第三方技能可列。
 */
describe("skills override wiring guards", () => {
  it("passes skillsOverride at both DefaultResourceLoader construction sites", () => {
    const source = read("src/main/extensions/pi-extension-host.ts");
    const loaders = source.match(/new DefaultResourceLoader\(/g) ?? [];
    const overrides = source.match(/skillsOverride:/g) ?? [];
    // host 构造 + 会话级派生 + 启动空跑的一次性 loader：每处都要带 override，
    // 漏掉任何一处，第三方默认关就只在部分路径生效。
    expect(loaders.length).toBeGreaterThanOrEqual(2);
    expect(overrides.length).toBe(loaders.length);
  });

  it("warms up one scan at startup so the skills page has data", () => {
    expect(read("src/main/index.ts")).toContain("warmUpExternalSkillScan(");
  });

  it("injects the policy through the module-level provider, not through host options", () => {
    // host 按 cwd 缓存、构造参数只在首次生效：策略必须由 provider 在调用时供给，
    // 否则插件页/信任弹窗先建 host 时会把过滤整条吞掉。
    const indexSource = read("src/main/index.ts");
    expect(indexSource).toContain("setSkillsPolicyProvider(");
    expect(read("src/main/agent/agent-runner.ts")).not.toContain(
      "skillsPolicy:",
    );
  });
});
