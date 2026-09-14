import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_SCAN_FILE_CAP,
  scanWorkspaceFiles,
} from "../main/workspace-file-scan";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "deskwand-scan-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(relPath: string, content = "x"): Promise<void> {
  const full = join(root, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

describe("scanWorkspaceFiles", () => {
  it("lists nested files with posix relative paths", async () => {
    await touch("src/data/report.csv");
    await touch("README.md");

    const result = await scanWorkspaceFiles(root);

    expect(result.truncated).toBe(false);
    expect(result.files.map((f) => f.relPath).sort()).toEqual([
      "README.md",
      "src/data/report.csv",
    ]);
  });

  it("reports file sizes", async () => {
    await touch("a.txt", "12345");

    const result = await scanWorkspaceFiles(root);

    expect(result.files).toEqual([{ relPath: "a.txt", size: 5 }]);
  });

  it("skips dot entries, node_modules and .tmp", async () => {
    await touch("keep.ts");
    await touch(".hidden/secret.ts");
    await touch(".env");
    await touch("node_modules/pkg/index.js");
    await touch(".tmp/old-attachment.pdf");

    const result = await scanWorkspaceFiles(root);

    expect(result.files.map((f) => f.relPath)).toEqual(["keep.ts"]);
  });

  it("sorts by mtime descending", async () => {
    await touch("old.txt");
    await touch("new.txt");
    const past = new Date(2000, 0, 1);
    await utimes(join(root, "old.txt"), past, past);

    const result = await scanWorkspaceFiles(root);

    expect(result.files[0].relPath).toBe("new.txt");
  });

  it("stops at the cap and flags truncation", async () => {
    await mkdir(join(root, "many"), { recursive: true });
    await Promise.all(
      Array.from({ length: WORKSPACE_SCAN_FILE_CAP + 5 }, (_, i) =>
        writeFile(join(root, "many", `f${i}.txt`), "x"),
      ),
    );

    const result = await scanWorkspaceFiles(root);

    expect(result.files).toHaveLength(WORKSPACE_SCAN_FILE_CAP);
    expect(result.truncated).toBe(true);
  });

  it("does not claim truncation when the whole tree fits", async () => {
    await mkdir(join(root, "many"), { recursive: true });
    await Promise.all(
      Array.from({ length: WORKSPACE_SCAN_FILE_CAP }, (_, i) =>
        writeFile(join(root, "many", `f${i}.txt`), "x"),
      ),
    );

    const result = await scanWorkspaceFiles(root);

    expect(result.files).toHaveLength(WORKSPACE_SCAN_FILE_CAP);
    expect(result.truncated).toBe(false);
  });

  it("tolerates a missing root directory", async () => {
    const result = await scanWorkspaceFiles(join(root, "does-not-exist"));

    expect(result).toEqual({ files: [], truncated: false });
  });
});
