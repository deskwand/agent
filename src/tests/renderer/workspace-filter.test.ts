import { describe, expect, it } from "vitest";
import {
  FILTER_RESULT_CAP,
  filterWorkspaceFiles,
} from "../../renderer/utils/workspace-filter";

const FILES = [
  { relPath: "README.md", size: 30 },
  { relPath: "src/renderer/attach/picker-items.ts", size: 1200 },
  { relPath: "src/renderer/utils/Attached-Files.ts", size: 900 },
  { relPath: "design-docs/PAPER.md", size: 400 },
];

describe("filterWorkspaceFiles", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(filterWorkspaceFiles(FILES, "")).toEqual({
      matches: [],
      total: 0,
    });
    expect(filterWorkspaceFiles(FILES, "   ")).toEqual({
      matches: [],
      total: 0,
    });
  });

  it("matches case-insensitively on the relative path", () => {
    expect(
      filterWorkspaceFiles(FILES, "readme").matches.map((f) => f.relPath),
    ).toEqual(["README.md"]);
    expect(
      filterWorkspaceFiles(FILES, "attached").matches.map((f) => f.relPath),
    ).toEqual(["src/renderer/utils/Attached-Files.ts"]);
  });

  it("matches a directory segment, not just the file name", () => {
    expect(
      filterWorkspaceFiles(FILES, "attach/").matches.map((f) => f.relPath),
    ).toEqual(["src/renderer/attach/picker-items.ts"]);
  });

  it("reports the pre-truncation total and caps matches", () => {
    const result = filterWorkspaceFiles(FILES, "s", 2);

    expect(result.matches).toHaveLength(2);
    expect(result.total).toBeGreaterThan(2);
  });

  it("keeps the documented display cap", () => {
    expect(FILTER_RESULT_CAP).toBe(200);
  });

  it("returns an empty result when nothing matches", () => {
    expect(filterWorkspaceFiles(FILES, "zzz")).toEqual({
      matches: [],
      total: 0,
    });
  });
});
