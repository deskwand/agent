import { describe, expect, it } from "vitest";
import {
  EMPTY_REPO_SUMMARY,
  parseBranchName,
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
