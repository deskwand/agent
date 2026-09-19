import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import jsYaml from "js-yaml";
import { parse as parseYaml } from "yaml";

const {
  injectReleaseNotes,
  findManifests,
} = require("../scripts/inject-release-notes.js");

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeReleaseDir(): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-inject-notes-"));
  tempDirs.push(dir);
  return dir;
}

/** The shape electron-builder emits: files block, then top-level keys. */
function writeManifest(dir: string, name = "latest.yml"): string {
  const manifestPath = path.join(dir, name);
  fs.writeFileSync(
    manifestPath,
    [
      "version: 1.0.38",
      "files:",
      "  - url: DeskWand-1.0.38-win-x64.exe",
      "    sha512: abc==",
      "    size: 167014251",
      "path: DeskWand-1.0.38-win-x64.exe",
      "sha512: abc==",
      'releaseDate: "2026-09-19T04:06:49.813Z"',
      "",
    ].join("\n"),
  );
  return manifestPath;
}

function writeNotes(
  dir: string,
  contents: string,
  name = "notes.json",
): string {
  const notesPath = path.join(dir, name);
  fs.writeFileSync(notesPath, contents);
  return notesPath;
}

const NOTES = { zh: "中文摘要\n- 第一条", en: "English summary\n- first" };

describe("injectReleaseNotes", () => {
  it("round-trips the notes through the manifest as a JSON string", () => {
    const dir = makeReleaseDir();
    const manifestPath = writeManifest(dir);
    const notesPath = writeNotes(dir, JSON.stringify(NOTES));

    const result = injectReleaseNotes(dir, notesPath);
    expect(result.injected).toEqual(["latest.yml"]);

    const parsed = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(typeof parsed.releaseNotes).toBe("string");
    expect(JSON.parse(parsed.releaseNotes)).toEqual(NOTES);
  });

  // js-yaml is what electron-updater itself calls to read the manifest; `yaml`
  // above only proves our own round trip. Both must accept the injected block.
  it("stays parseable by the parser electron-updater uses", () => {
    const dir = makeReleaseDir();
    const manifestPath = writeManifest(dir);
    // Content chosen to break a naive block scalar: colons, quotes, pipes,
    // hashes, a leading dash, CJK, and unicode line separators.
    const tricky = {
      zh: '标点：冒号 "引号" | 管道 # 井号 \n- 列表项 \n\u2028分隔',
      en: 'Colons: here "quoted" | pipe # hash\n- item ħ\u2029sep',
    };
    const notesPath = writeNotes(dir, JSON.stringify(tricky));

    injectReleaseNotes(dir, notesPath);

    const parsed = jsYaml.load(fs.readFileSync(manifestPath, "utf-8")) as {
      version: string;
      releaseNotes: string;
    };
    expect(typeof parsed.releaseNotes).toBe("string");
    expect(JSON.parse(parsed.releaseNotes)).toEqual(tricky);
    expect(parsed.version).toBe("1.0.38");
  });

  it("leaves the manifest's other keys untouched", () => {
    const dir = makeReleaseDir();
    const manifestPath = writeManifest(dir);
    const notesPath = writeNotes(dir, JSON.stringify(NOTES));

    injectReleaseNotes(dir, notesPath);

    const parsed = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(parsed.version).toBe("1.0.38");
    expect(parsed.files).toEqual([
      {
        url: "DeskWand-1.0.38-win-x64.exe",
        sha512: "abc==",
        size: 167014251,
      },
    ]);
    expect(parsed.path).toBe("DeskWand-1.0.38-win-x64.exe");
  });

  it("is idempotent — running twice leaves exactly one releaseNotes key", () => {
    const dir = makeReleaseDir();
    const manifestPath = writeManifest(dir);
    const notesPath = writeNotes(dir, JSON.stringify(NOTES));

    injectReleaseNotes(dir, notesPath);
    const once = fs.readFileSync(manifestPath, "utf-8");
    injectReleaseNotes(dir, notesPath);
    const twice = fs.readFileSync(manifestPath, "utf-8");

    expect(twice).toBe(once);
    expect(twice.match(/^releaseNotes:/gm)).toHaveLength(1);
    expect(JSON.parse(parseYaml(twice).releaseNotes)).toEqual(NOTES);
  });

  it("injects into every manifest that exists, and only those", () => {
    const dir = makeReleaseDir();
    // latest-linux.yml is deliberately absent: a mac-only local release dir
    // must not fail, and the injector must not invent files.
    writeManifest(dir, "latest.yml");
    writeManifest(dir, "latest-mac.yml");
    const notesPath = writeNotes(dir, JSON.stringify(NOTES));

    const result = injectReleaseNotes(dir, notesPath);

    // Sorted, so the order is stable regardless of readdir().
    expect(result.injected).toEqual(["latest-mac.yml", "latest.yml"]);
  });

  it("picks up channel manifests beyond the three usual names", () => {
    const dir = makeReleaseDir();
    writeManifest(dir, "latest.yml");
    writeManifest(dir, "latest-linux-arm64.yml");
    writeManifest(dir, "other.yml");
    const notesPath = writeNotes(dir, JSON.stringify(NOTES));

    expect(findManifests(dir)).toEqual([
      "latest-linux-arm64.yml",
      "latest.yml",
    ]);
    expect(injectReleaseNotes(dir, notesPath).injected).toEqual([
      "latest-linux-arm64.yml",
      "latest.yml",
    ]);
    expect(fs.readFileSync(path.join(dir, "other.yml"), "utf-8")).not.toContain(
      "releaseNotes",
    );
  });

  it("throws when the notes file is missing", () => {
    const dir = makeReleaseDir();
    writeManifest(dir);

    expect(() =>
      injectReleaseNotes(dir, path.join(dir, "update-notes-1.0.38.json")),
    ).toThrow(/not found/);
  });

  it("throws on invalid JSON", () => {
    const dir = makeReleaseDir();
    writeManifest(dir);

    expect(() => injectReleaseNotes(dir, writeNotes(dir, "{oops"))).toThrow(
      /not valid JSON/,
    );
  });

  it.each([
    ["missing en", { zh: "中文" }],
    ["blank zh", { zh: "   ", en: "english" }],
    ["non-string en", { zh: "中文", en: 42 }],
    ["array payload", ["中文", "english"]],
  ])("throws on a malformed payload: %s", (_label, payload) => {
    const dir = makeReleaseDir();
    writeManifest(dir);

    expect(() =>
      injectReleaseNotes(dir, writeNotes(dir, JSON.stringify(payload))),
    ).toThrow(/release notes/);
  });
});
