import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { syncManifest, MANIFEST } = require("../scripts/sync-linux-manifest.js");

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeReleaseDir(): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-linux-manifest-"));
  tempDirs.push(dir);
  return dir;
}

function writeArtifact(dir: string, name: string, contents: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents);
  return crypto.createHash("sha512").update(contents).digest("base64");
}

/** The shape electron-builder emits: a files block, then top-level path/sha512. */
function writeManifest(
  dir: string,
  entries: Array<{ url: string; sha512: string; size: number }>,
  topLevelSha512?: string,
): void {
  const lines = ["version: 1.0.37", "files:"];
  for (const entry of entries) {
    lines.push(`  - url: ${entry.url}`);
    lines.push(`    sha512: ${entry.sha512}`);
    lines.push(`    size: ${entry.size}`);
  }
  // The top-level pair points at the AppImage, which package-linux.sh never
  // rebuilds, so it is deliberately allowed to differ from entries[0].
  lines.push(`path: ${entries[0]?.url ?? "none"}`);
  lines.push(`sha512: ${topLevelSha512 ?? entries[0]?.sha512 ?? "none"}`);
  fs.writeFileSync(path.join(dir, MANIFEST), `${lines.join("\n")}\n`);
}

function readManifest(dir: string): string {
  return fs.readFileSync(path.join(dir, MANIFEST), "utf8");
}

describe("linux manifest sync", () => {
  it("rewrites an entry that describes a file the deb rebuild replaced", async () => {
    // This is the shipped bug: package-linux.sh overwrites the deb after
    // electron-builder hashed it, so the manifest keeps the stale numbers.
    const dir = makeReleaseDir();
    const realSha = writeArtifact(
      dir,
      "DeskWand-1.0.37-linux-amd64.deb",
      "rebuilt-by-package-linux",
    );
    writeManifest(
      dir,
      [
        {
          url: "DeskWand-1.0.37-linux-amd64.deb",
          sha512: "stale-from-electron-builder",
          size: 186224728,
        },
      ],
      "top-level-appimage-sha",
    );

    const result = await syncManifest(dir);

    expect(result.changed.map((c: { url: string }) => c.url)).toEqual([
      "DeskWand-1.0.37-linux-amd64.deb",
    ]);
    expect(result.changed[0].from.size).toBe(186224728);
    expect(result.changed[0].to.sha512).toBe(realSha);
    expect(result.missing).toEqual([]);

    const manifest = readManifest(dir);
    expect(manifest).toContain(`sha512: ${realSha}`);
    expect(manifest).toContain(
      `size: ${Buffer.byteLength("rebuilt-by-package-linux")}`,
    );
    expect(manifest).not.toContain("stale-from-electron-builder");
    // The top-level pair is untouched, so it keeps its own value.
    expect(manifest).toContain("sha512: top-level-appimage-sha");
  });

  it("leaves the top-level path and sha512 alone", async () => {
    // The top-level pair points at the AppImage, which this script never rebuilds.
    const dir = makeReleaseDir();
    const appImageSha = writeArtifact(
      dir,
      "DeskWand-1.0.37-linux-x86_64.AppImage",
      "appimage",
    );
    writeManifest(
      dir,
      [
        {
          url: "DeskWand-1.0.37-linux-x86_64.AppImage",
          sha512: appImageSha,
          size: Buffer.byteLength("appimage"),
        },
      ],
      appImageSha,
    );

    const result = await syncManifest(dir);

    expect(result.changed).toEqual([]);
    const manifest = readManifest(dir);
    expect(manifest).toContain("path: DeskWand-1.0.37-linux-x86_64.AppImage");
    expect(manifest).toContain(`sha512: ${appImageSha}`);
  });

  it("is idempotent once the manifest agrees with disk", async () => {
    const dir = makeReleaseDir();
    const sha = writeArtifact(dir, "DeskWand-1.0.37-linux-amd64.deb", "deb");
    writeManifest(dir, [
      { url: "DeskWand-1.0.37-linux-amd64.deb", sha512: "wrong", size: 3 },
    ]);

    const first = await syncManifest(dir);
    expect(first.changed).toHaveLength(1);
    const afterFirst = readManifest(dir);

    const second = await syncManifest(dir);
    expect(second.changed).toEqual([]);
    expect(readManifest(dir)).toBe(afterFirst);
    expect(readManifest(dir)).toContain(`sha512: ${sha}`);
  });

  it("reports a listed artifact that is not on disk instead of inventing numbers", async () => {
    // A missing AppImage must stay visible rather than silently hashing nothing.
    const dir = makeReleaseDir();
    writeArtifact(dir, "DeskWand-1.0.37-linux-amd64.deb", "deb");
    writeManifest(dir, [
      {
        url: "DeskWand-1.0.37-linux-x86_64.AppImage",
        sha512: "expected-sha",
        size: 247533886,
      },
      { url: "DeskWand-1.0.37-linux-amd64.deb", sha512: "wrong", size: 1 },
    ]);

    const result = await syncManifest(dir);

    expect(result.missing).toEqual(["DeskWand-1.0.37-linux-x86_64.AppImage"]);
    expect(result.changed.map((c: { url: string }) => c.url)).toEqual([
      "DeskWand-1.0.37-linux-amd64.deb",
    ]);
    expect(readManifest(dir)).toContain("sha512: expected-sha");
  });

  it("reports a skipped sync when there is no manifest to update", async () => {
    const dir = makeReleaseDir();
    const result = await syncManifest(dir);
    expect(result.skipped).toContain(MANIFEST);
    expect(result.changed).toEqual([]);
  });

  it("is wired into the deb target of package-linux.sh", () => {
    // The fix only holds if the deb rebuild actually calls it.
    const script = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/package-linux.sh"),
      "utf8",
    );
    const debBranch = script.slice(script.indexOf("    deb)"));
    expect(debBranch).toContain("build_deb");
    expect(debBranch.indexOf("sync-linux-manifest.js")).toBeGreaterThan(
      debBranch.indexOf("build_deb"),
    );
  });
});
