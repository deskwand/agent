import { describe, expect, it } from "vitest";
import {
  EMPTY_REPO_SUMMARY,
  isNotAGitRepositoryError,
  parseBranchName,
  parseNumstatTotals,
} from "../src/shared/repo-summary";

describe("parseBranchName", () => {
  it("returns the branch name without the trailing newline", () => {
    expect(parseBranchName("feature/session-overview\n")).toBe(
      "feature/session-overview",
    );
  });

  it("returns HEAD when the repo sits on a detached HEAD", () => {
    expect(parseBranchName("HEAD\n")).toBe("HEAD");
  });

  it("returns null for empty output (empty repo or failed command)", () => {
    expect(parseBranchName("   \n")).toBeNull();
  });
});

describe("EMPTY_REPO_SUMMARY", () => {
  it("is not a repository and has zero counts", () => {
    expect(EMPTY_REPO_SUMMARY).toEqual({
      isRepo: false,
      branch: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      untracked: 0,
    });
  });
});

describe("parseNumstatTotals", () => {
  it("sums additions and deletions across files", () => {
    const stdout = ["12\t3\tsrc/a.ts", "0\t7\tsrc/b.ts", ""].join("\n");
    expect(parseNumstatTotals(stdout)).toEqual({
      additions: 12,
      deletions: 10,
    });
  });

  it("counts binary files (- -) as zero", () => {
    expect(parseNumstatTotals("-\t-\tassets/logo.png\n")).toEqual({
      additions: 0,
      deletions: 0,
    });
  });

  it("returns zeros for an empty diff", () => {
    expect(parseNumstatTotals("")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("isNotAGitRepositoryError", () => {
  it("recognises git's not-a-repository stderr", () => {
    expect(
      isNotAGitRepositoryError(
        "fatal: not a git repository (or any of the parent directories): .git",
      ),
    ).toBe(true);
  });

  it("does not treat other git failures as a missing repository", () => {
    expect(
      isNotAGitRepositoryError(
        "fatal: ambiguous argument 'HEAD': unknown revision",
      ),
    ).toBe(false);
    expect(isNotAGitRepositoryError(undefined)).toBe(false);
    expect(isNotAGitRepositoryError("")).toBe(false);
  });
});
