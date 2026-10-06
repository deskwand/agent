import { describe, expect, it, vi } from "vitest";

// 这两个 mock 不是因为用例需要它们，而是因为 `skills-manager.ts` 在模块作用域 import 了
// electron 与 logger（同 `vault-source.test.ts` 的做法）。
vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getVersion: () => "0.0.0-test",
    getPath: () => process.cwd(),
  },
}));
vi.mock("../../main/utils/logger", () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { buildSkillPaths } from "../../main/skills/skills-manager";

describe("buildSkillPaths", () => {
  it("returns one path per enabled skill", () => {
    const dirs = new Map([
      ["builtin-officecli", "/builtin/officecli"],
      ["global-my-notes", "/global/my-notes"],
    ]);
    expect(
      buildSkillPaths(
        [
          { id: "builtin-officecli", enabled: true },
          { id: "global-my-notes", enabled: true },
        ],
        dirs,
      ),
    ).toEqual(["/builtin/officecli", "/global/my-notes"]);
  });

  it("skips disabled skills", () => {
    const dirs = new Map([
      ["builtin-officecli", "/builtin/officecli"],
      ["builtin-ponytail", "/builtin/ponytail"],
    ]);
    expect(
      buildSkillPaths(
        [
          { id: "builtin-officecli", enabled: true },
          { id: "builtin-ponytail", enabled: false },
        ],
        dirs,
      ),
    ).toEqual(["/builtin/officecli"]);
  });

  it("never returns the same directory twice", () => {
    // 同名技能由调用方的 `deduplicateSkills()` 按名去重：这里只防「不同 id 指向同一目录」。
    const dirs = new Map([
      ["builtin-officecli", "/skills/officecli"],
      ["global-officecli", "/skills/officecli"],
    ]);
    expect(
      buildSkillPaths(
        [
          { id: "builtin-officecli", enabled: true },
          { id: "global-officecli", enabled: true },
        ],
        dirs,
      ),
    ).toEqual(["/skills/officecli"]);
  });

  it("drops a name entirely when its winner is disabled", () => {
    // 按名去重后的赢家被禁用 ⇒ 这个技能整体不交给 pi（被淘汰的那份不会把它救回来）。
    const dirs = new Map([
      ["builtin-ponytail", "/builtin/ponytail"],
      ["global-ponytail", "/global/ponytail"],
    ]);
    expect(
      buildSkillPaths([{ id: "builtin-ponytail", enabled: false }], dirs),
    ).toEqual([]);
  });

  it("skips skills with no recorded directory", () => {
    // 目录存在但没有 SKILL.md、或旧版 json 配置技能：没有目录就不交给 pi。
    expect(
      buildSkillPaths([{ id: "custom-legacy", enabled: true }], new Map()),
    ).toEqual([]);
  });
});
