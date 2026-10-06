import { describe, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import {
  buildSkillsSignature,
  isProductSkillPath,
  selectSkillsForPrompt,
  type SkillPromptPolicy,
} from "../../main/skills/external-skill-policy";

const PRODUCT_ROOTS = ["/app/resources/skills", "/home/u/.deskwand/skills"];

/** 造一个 pi 形状的 Skill；只有 name / filePath 参与本模块的逻辑。 */
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

function policy(overrides: Partial<SkillPromptPolicy> = {}): SkillPromptPolicy {
  const recorded: string[] = [];
  return {
    productRoots: PRODUCT_ROOTS,
    isProductSkillEnabled: () => true,
    isExternalSkillEnabled: () => false,
    enabledExternalSkillNames: () => [],
    enabledProductSkillDirs: () => [],
    recordExternalSkills: (records) => {
      recorded.push(...records.map((r) => r.name));
    },
    ...overrides,
  };
}

const loadNothing = () => undefined;

describe("isProductSkillPath", () => {
  it("matches the root itself and anything under it", () => {
    expect(
      isProductSkillPath(
        "/app/resources/skills/officecli/SKILL.md",
        PRODUCT_ROOTS,
      ),
    ).toBe(true);
    expect(isProductSkillPath("/app/resources/skills", PRODUCT_ROOTS)).toBe(
      true,
    );
    expect(
      isProductSkillPath("/home/u/.pi/agent/skills/x/SKILL.md", PRODUCT_ROOTS),
    ).toBe(false);
    // 前缀相似但不是同一棵树
    expect(
      isProductSkillPath(
        "/app/resources/skills-backup/x/SKILL.md",
        PRODUCT_ROOTS,
      ),
    ).toBe(false);
  });
});

describe("selectSkillsForPrompt", () => {
  const base = [
    skill("officecli", "/app/resources/skills/officecli/SKILL.md"),
    skill("writing-plans", "/home/u/.pi/agent/skills/writing-plans/SKILL.md"),
    skill(
      "deskwand-release",
      "/home/u/.pi/agent/skills/deskwand-release/SKILL.md",
    ),
    skill("brainstorming", "/home/u/.pi/agent/skills/brainstorming/SKILL.md"),
  ];

  it("keeps enabled product skills and drops third-party ones by default", () => {
    const result = selectSkillsForPrompt({
      base,
      policy: policy({ isProductSkillEnabled: (n) => n === "officecli" }),
      loadSkillFromDir: loadNothing,
    });
    expect(result.kept.map((s) => s.name)).toEqual(["officecli"]);
    expect(result.externals.map((r) => r.name)).toEqual([
      "writing-plans",
      "deskwand-release",
      "brainstorming",
    ]);
  });

  it("records each third-party name once even when several copies are discovered", () => {
    const result = selectSkillsForPrompt({
      base: [
        skill(
          "writing-plans",
          "/home/u/.pi/agent/skills/writing-plans/SKILL.md",
        ),
        skill("writing-plans", "/home/u/.agents/skills/writing-plans/SKILL.md"),
      ],
      policy: policy(),
      loadSkillFromDir: loadNothing,
    });
    expect(result.externals.map((r) => r.name)).toEqual(["writing-plans"]);
  });

  it("keeps third-party skills the user enabled", () => {
    const result = selectSkillsForPrompt({
      base,
      policy: policy({
        isProductSkillEnabled: () => false,
        isExternalSkillEnabled: (n) => n === "deskwand-release",
      }),
      loadSkillFromDir: loadNothing,
    });
    expect(result.kept.map((s) => s.name)).toEqual(["deskwand-release"]);
  });

  it("lets the product copy win a same-name collision and reports the shadowed one", () => {
    // 用户同时开着产品那份与外部那份：两边都在 base 里（策略自身的输入契约）。
    const productBrainstorming = skill(
      "brainstorming",
      "/app/resources/skills/brainstorming/SKILL.md",
    );
    const result = selectSkillsForPrompt({
      base: [productBrainstorming, ...base],
      policy: policy({ isExternalSkillEnabled: (n) => n === "brainstorming" }),
      loadSkillFromDir: loadNothing,
    });
    const names = result.kept.map((s) => s.name);
    expect(names.filter((n) => n === "brainstorming")).toHaveLength(1);
    expect(result.kept.find((s) => s.name === "brainstorming")?.filePath).toBe(
      productBrainstorming.filePath,
    );
    expect(result.shadowed).toEqual(["brainstorming"]);
  });

  it("product still wins when pi already dropped its copy (base has only the third-party one)", () => {
    // pi 先按名去重、外部副本排在前 ⇒ base 里只有外部那份。用户又把它打开了。
    // 这时产品那份必须从自己的目录读回来并顶掉外部那份（否则提示里是第三方的）。
    const productBrainstorming = skill(
      "brainstorming",
      "/app/resources/skills/brainstorming/SKILL.md",
    );
    const result = selectSkillsForPrompt({
      base: [
        skill(
          "brainstorming",
          "/home/u/.pi/agent/skills/brainstorming/SKILL.md",
        ),
      ],
      policy: policy({
        isProductSkillEnabled: (n) => n === "brainstorming",
        isExternalSkillEnabled: () => true,
        enabledProductSkillDirs: () => ["/app/resources/skills/brainstorming"],
      }),
      loadSkillFromDir: () => productBrainstorming,
    });
    expect(result.kept.map((s) => s.name)).toEqual(["brainstorming"]);
    expect(result.kept[0].filePath).toBe(productBrainstorming.filePath);
    expect(result.shadowed).toEqual(["brainstorming"]);
  });

  it("reads back an enabled product skill whose copy lost the collision", () => {
    // base 里只有外部那份 brainstorming（产品那份被赢掉了）。
    const loaded: string[] = [];
    const productBrainstorming = skill(
      "brainstorming",
      "/app/resources/skills/brainstorming/SKILL.md",
    );
    const result = selectSkillsForPrompt({
      base: [
        skill(
          "brainstorming",
          "/home/u/.pi/agent/skills/brainstorming/SKILL.md",
        ),
      ],
      policy: policy({
        isProductSkillEnabled: (n) => n === "brainstorming",
        isExternalSkillEnabled: () => false,
        enabledProductSkillDirs: () => ["/app/resources/skills/brainstorming"],
      }),
      loadSkillFromDir: (dir) => {
        loaded.push(dir);
        return productBrainstorming;
      },
    });
    expect(loaded).toEqual(["/app/resources/skills/brainstorming"]);
    expect(result.kept.map((s) => s.name)).toEqual(["brainstorming"]);
    expect(result.kept[0].filePath).toBe(productBrainstorming.filePath);
  });

  it("does not duplicate a product skill that is already kept", () => {
    const loaded: string[] = [];
    const result = selectSkillsForPrompt({
      base: [skill("officecli", "/app/resources/skills/officecli/SKILL.md")],
      policy: policy({
        isProductSkillEnabled: () => true,
        enabledProductSkillDirs: () => ["/app/resources/skills/officecli"],
      }),
      loadSkillFromDir: (dir) => {
        loaded.push(dir);
        return skill("officecli", `${dir}/SKILL.md`);
      },
    });
    expect(loaded).toEqual([]);
    expect(result.kept.map((s) => s.name)).toEqual(["officecli"]);
  });

  it("does not throw when the enabled directory no longer yields a skill", () => {
    const result = selectSkillsForPrompt({
      base: [],
      policy: policy({
        isProductSkillEnabled: () => true,
        enabledProductSkillDirs: () => ["/app/resources/skills/gone"],
      }),
      loadSkillFromDir: () => undefined,
    });
    expect(result.kept).toEqual([]);
  });
});

describe("buildSkillsSignature", () => {
  it("changes when the enabled third-party set changes", () => {
    const paths = ["/app/resources/skills/officecli"];
    expect(buildSkillsSignature(paths, ["deskwand-release"])).not.toBe(
      buildSkillsSignature(paths, []),
    );
  });

  it("is order-insensitive", () => {
    expect(buildSkillsSignature(["b", "a"], ["y", "x"])).toBe(
      buildSkillsSignature(["a", "b"], ["x", "y"]),
    );
  });
});
