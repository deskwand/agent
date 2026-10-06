import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildSkillsSignature } from "../../main/skills/external-skill-policy";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("skills 签名包含第三方启用集合", () => {
  it("签名随第三方集合变化（缓存键必须变，否则开关不重建会话）", () => {
    const paths = ["/app/resources/skills/officecli"];
    expect(buildSkillsSignature(paths, ["writing-plans"])).not.toBe(
      buildSkillsSignature(paths, []),
    );
  });

  it("agent-runner 用 buildSkillsSignature 组装签名", () => {
    // 接线守卫：改了签名组成却漏掉 runner 时，开关会静默失效。
    const source = read("src/main/agent/agent-runner.ts");
    expect(source).toContain("buildSkillsSignature(");
    expect(source).toContain("enabledExternalSkillNames()");
  });
});
