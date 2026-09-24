import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSkillName } from "../src/main/skills/skills-manager";

/**
 * 技能的 IPC handler 从渲染层接收 `skillName` 并直接拼路径。若不校验，
 * `skillName = "../../.ssh/authorized_keys"` 就能写到技能目录之外。
 *
 * 完整的行为测试需要 mock 整个主进程入口（index.ts 的顶层会初始化 OAuth、
 * DB、窗口），代价远大于收益；这里改为两条更可靠的断言：
 *   1. 围栏函数本身的行为
 *   2. 源码里每个面向 skillName 的 handler 都调用了它
 * 行为侧另有一条测试走真实的 SkillsManager（uninstallSkill 的既有围栏）。
 */
describe("skill name path fence", () => {
  it("rejects traversal and separator skill names", () => {
    const hostile = [
      "../escape",
      "../../.ssh/authorized_keys",
      "..",
      "foo/bar",
      "foo\\bar",
      "",
    ];
    for (const name of hostile) {
      expect(() => validateSkillName(name), name).toThrow("Invalid skill name");
    }
  });

  it("accepts real skill names", () => {
    for (const name of [
      "dev-pipeline",
      "lark-sheets",
      "a",
      "skill2",
      ".hidden",
    ]) {
      expect(() => validateSkillName(name), name).not.toThrow();
    }
  });

  it("fences every skill.* handler that joins a path from the renderer", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/main/index.ts"),
      "utf-8",
    );

    const fencingHandlers = [
      "skills.packageToZip",
      "skills.computeContentFingerprint",
      "skills.writeFingerprint",
      "skills.readSkillMd",
      "skills.writeInstalledMeta",
      "skills.readInstalledMeta",
      "skills.deleteFingerprint",
      "skills.readFingerprint",
    ];

    // 每个 handler 的块内必须出现一次 validateSkillName(skillName)
    for (const channel of fencingHandlers) {
      const start = source.indexOf(`"${channel}"`);
      expect(start, `${channel} not found`).toBeGreaterThan(-1);
      const nextHandler = source.indexOf("ipcMain.handle(", start + 1);
      const block = source.slice(
        start,
        nextHandler === -1 ? undefined : nextHandler,
      );
      expect(block, `${channel} is missing the fence`).toContain(
        "validateSkillName(skillName)",
      );
    }
  });
});
