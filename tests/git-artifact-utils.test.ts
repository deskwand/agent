import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  countChangedFilesFromPorcelain,
  partitionArtifactPaths,
} from "../src/main/git-artifact-utils";

describe("git artifact utils", () => {
  it("counts tracked and untracked files from porcelain output", () => {
    const status = [
      " M src/main/index.ts",
      "?? tmp/new-file.ts",
      "R  src/old-name.ts -> src/new-name.ts",
      "",
    ].join("\n");

    expect(countChangedFilesFromPorcelain(status)).toBe(3);
  });

  it("treats created-then-edited untracked files as deletions and resolves relative paths", () => {
    const cwd = path.join("/workspace", "repo");
    const tracked = new Set(["src/tracked.ts"]);

    expect(
      partitionArtifactPaths(
        cwd,
        ["src/tracked.ts", ".tmp/generated.md", path.join(cwd, "notes/todo.md")],
        tracked,
      ),
    ).toEqual({
      trackedRelativePaths: ["src/tracked.ts"],
      untrackedAbsolutePaths: [
        path.join(cwd, ".tmp/generated.md"),
        path.join(cwd, "notes/todo.md"),
      ],
    });
  });
});
