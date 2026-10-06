import { describe, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { createSkillsOverride } from "../../main/skills/skills-prompt-override";
import type {
  ExternalSkillRecord,
  SkillPromptPolicy,
} from "../../main/skills/external-skill-policy";

function skill(name: string, filePath: string): Skill {
  return {
    name,
    description: `${name} desc`,
    filePath,
    baseDir: filePath.replace(/\/SKILL\.md$/, ""),
    sourceInfo: {
      path: filePath,
      source: "local",
      scope: "user",
      origin: "top-level",
    },
    disableModelInvocation: false,
  } as Skill;
}

const base = {
  skills: [
    skill("officecli", "/app/resources/skills/officecli/SKILL.md"),
    skill("writing-plans", "/home/u/.pi/agent/skills/writing-plans/SKILL.md"),
  ],
  diagnostics: [],
};

function makePolicy(recorded: ExternalSkillRecord[]): SkillPromptPolicy {
  return {
    productRoots: ["/app/resources/skills"],
    isProductSkillEnabled: () => true,
    isExternalSkillEnabled: () => false,
    enabledExternalSkillNames: () => [],
    enabledProductSkillDirs: () => [],
    recordExternalSkills: (records) => {
      recorded.push(...records);
    },
  };
}

describe("createSkillsOverride", () => {
  it("策略还没注入时原样放行", () => {
    const override = createSkillsOverride(() => undefined);
    expect(override(base).skills.map((s) => s.name)).toEqual([
      "officecli",
      "writing-plans",
    ]);
  });

  it("按策略过滤，并上报第三方全集", () => {
    const recorded: ExternalSkillRecord[] = [];
    const result = createSkillsOverride(() => makePolicy(recorded))(base);
    expect(result.skills.map((s) => s.name)).toEqual(["officecli"]);
    expect(recorded.map((r) => r.name)).toEqual(["writing-plans"]);
  });

  it("策略是调用时取的 —— 后注入也能生效", () => {
    // PiExtensionHost 按 cwd 缓存，谁先建 host 谁定构造参数；把策略绑在构造时
    // 会让「插件页先建 host」那条路把过滤整个吞掉。
    let policy: SkillPromptPolicy | undefined;
    const override = createSkillsOverride(() => policy);
    expect(override(base).skills).toHaveLength(2);

    policy = makePolicy([]);
    expect(override(base).skills.map((s) => s.name)).toEqual(["officecli"]);
  });
});
