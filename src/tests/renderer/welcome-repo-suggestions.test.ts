import { describe, expect, it } from "vitest";
import {
  EMPTY_REPO_SUMMARY,
  type RepoSummary,
} from "../../shared/repo-summary";
import {
  formatRepoFacts,
  welcomeRepoSuggestions,
} from "../../renderer/welcome-repo-suggestions";

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key) as never;

const dirtyRepo: RepoSummary = {
  isRepo: true,
  branch: "main",
  additions: 12,
  deletions: 3,
  changedFiles: 3,
  untracked: 1,
};

describe("formatRepoFacts", () => {
  it("非仓库或空快照时不产出文案", () => {
    expect(formatRepoFacts(null, t)).toBe("");
    expect(formatRepoFacts(EMPTY_REPO_SUMMARY, t)).toBe("");
  });

  it("干净仓库只给分支", () => {
    const clean: RepoSummary = {
      ...dirtyRepo,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      untracked: 0,
    };
    expect(formatRepoFacts(clean, t)).toBe("welcome.repo.branch(main)");
  });

  it("改动总数已含未跟踪，不重复相加", () => {
    expect(formatRepoFacts(dirtyRepo, t)).toBe(
      "welcome.repo.branch(main) · welcome.repo.dirty(3)",
    );
  });
});

describe("welcomeRepoSuggestions", () => {
  it("无仓库时不给建议", () => {
    expect(welcomeRepoSuggestions(null)).toEqual([]);
    expect(welcomeRepoSuggestions(EMPTY_REPO_SUMMARY)).toEqual([]);
  });

  it("有改动时给出「看改动」与「跑测试」", () => {
    expect(welcomeRepoSuggestions(dirtyRepo).map((s) => s.id)).toEqual([
      "review-changes",
      "run-tests",
    ]);
  });

  it("干净仓库给出「跑测试」与「解释上个提交」", () => {
    const clean: RepoSummary = {
      ...dirtyRepo,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      untracked: 0,
    };
    expect(welcomeRepoSuggestions(clean).map((s) => s.id)).toEqual([
      "run-tests",
      "explain-last-commit",
    ]);
  });
});

it("handles branchless and untracked repositories conservatively", () => {
  expect(formatRepoFacts({ ...dirtyRepo, branch: null }, t)).toBe(
    "welcome.repo.dirty(3)",
  );
  expect(
    formatRepoFacts({ ...dirtyRepo, changedFiles: 1, untracked: 1 }, t),
  ).toBe("welcome.repo.branch(main) · welcome.repo.dirty(1)");
  expect(
    welcomeRepoSuggestions({
      ...dirtyRepo,
      branch: null,
      changedFiles: 0,
      untracked: 0,
    }).map((s) => s.id),
  ).toEqual(["run-tests"]);
});
