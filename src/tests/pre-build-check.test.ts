import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// Import the runChecks function from the CommonJS script using createRequire
const require = createRequire(import.meta.url);
const {
  runChecks,
  resolveTargetPlatform,
} = require("../../scripts/pre-build-check.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pre-build-check-test-"));
}

function makeFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "// placeholder");
}

function makeDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Creates all artifacts that are required for a successful darwin/arm64 check.
 */
function populateDarwinArtifacts(root: string, arch: string = "arm64"): void {
  // Common FATAL resources
  makeFile(path.join(root, ".bundle-resources/mcp/gui-operate-server.js"));
  makeFile(
    path.join(root, ".bundle-resources/mcp/software-dev-server-example.js"),
  );
  makeDir(path.join(root, "dist-electron"));
  makeDir(path.join(root, "dist"));
  makeDir(path.join(root, ".deskwand/skills"));

  // macOS FATAL resources
  makeFile(path.join(root, `resources/node/darwin-${arch}/bin/node`));
  makeFile(path.join(root, "dist-lima-agent/index.js"));
  makeDir(path.join(root, `resources/bin/darwin-${arch}`));
  makeFile(path.join(root, `resources/bin/darwin-${arch}/officecli`));
  makeFile(path.join(root, `resources/bin/darwin-${arch}/cliclick`));
}

/**
 * Creates all artifacts that are required for a successful win32/x64 check.
 */
function populateWin32Artifacts(root: string): void {
  makeFile(path.join(root, ".bundle-resources/mcp/gui-operate-server.js"));
  makeFile(
    path.join(root, ".bundle-resources/mcp/software-dev-server-example.js"),
  );
  makeDir(path.join(root, "dist-electron"));
  makeDir(path.join(root, "dist"));
  makeDir(path.join(root, ".deskwand/skills"));
  makeFile(path.join(root, "resources/node/win32-x64/node.exe"));
  makeFile(path.join(root, "dist-wsl-agent/index.js"));
  makeDir(path.join(root, "resources/bin/win32-x64"));
  makeFile(path.join(root, "resources/bin/win32-x64/officecli.exe"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pre-build-check: runChecks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // All-pass scenarios
  // -------------------------------------------------------------------------

  it("passes all FATAL checks on darwin when required artifacts exist", () => {
    populateDarwinArtifacts(tmpDir, "arm64");

    const result = runChecks(tmpDir, "darwin", "arm64");

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // 5 common + 2 darwin FATAL = 7 FATAL checks should pass
    expect(result.passed).toBeGreaterThanOrEqual(7);
  });

  it("passes all FATAL checks on win32 when required artifacts exist", () => {
    populateWin32Artifacts(tmpDir);

    const result = runChecks(tmpDir, "win32", "x64");

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    expect(result.passed).toBeGreaterThanOrEqual(7);
  });

  it("reports warnings for optional darwin resources that are missing", () => {
    // Only populate FATAL items; leave warn items absent
    populateDarwinArtifacts(tmpDir, "x64");

    const result = runChecks(tmpDir, "darwin", "x64");

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // Only python remains optional on darwin => 1 warning
    expect(result.warnings).toBe(1);
  });

  it("reports zero warnings when optional darwin resources are present", () => {
    populateDarwinArtifacts(tmpDir, "x64");
    makeDir(path.join(tmpDir, "resources/python/darwin-x64"));

    const result = runChecks(tmpDir, "darwin", "x64");

    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.hasFatal).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Failure scenarios
  // -------------------------------------------------------------------------

  it("reports hasFatal when a common FATAL file is missing", () => {
    populateDarwinArtifacts(tmpDir, "arm64");
    // Remove a required common file
    fs.rmSync(path.join(tmpDir, ".bundle-resources/mcp/gui-operate-server.js"));

    const result = runChecks(tmpDir, "darwin", "arm64");

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it("reports hasFatal when dist-electron directory is missing", () => {
    populateDarwinArtifacts(tmpDir, "arm64");
    fs.rmSync(path.join(tmpDir, "dist-electron"), { recursive: true });

    const result = runChecks(tmpDir, "darwin", "arm64");

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it("reports hasFatal when darwin node binary is missing", () => {
    populateDarwinArtifacts(tmpDir, "arm64");
    fs.rmSync(path.join(tmpDir, "resources/node/darwin-arm64/bin/node"));

    const result = runChecks(tmpDir, "darwin", "arm64");

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it("reports hasFatal when win32 node.exe is missing", () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, "resources/node/win32-x64/node.exe"));

    const result = runChecks(tmpDir, "win32", "x64");

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it("reports hasFatal when wsl-agent index.js is missing", () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, "dist-wsl-agent/index.js"));

    const result = runChecks(tmpDir, "win32", "x64");

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it("reports hasFatal when lima-agent index.js is missing", () => {
    populateDarwinArtifacts(tmpDir, "arm64");
    fs.rmSync(path.join(tmpDir, "dist-lima-agent/index.js"));

    const result = runChecks(tmpDir, "darwin", "arm64");

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it("fails all checks when root directory is completely empty", () => {
    const result = runChecks(tmpDir, "darwin", "arm64");

    // All checks should fail or warn; none should pass
    expect(result.passed).toBe(0);
    expect(result.hasFatal).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it("returns a results array with one entry per check", () => {
    populateDarwinArtifacts(tmpDir, "arm64");

    const result = runChecks(tmpDir, "darwin", "arm64");

    expect(Array.isArray(result.results)).toBe(true);
    // Each result must have required fields
    for (const r of result.results) {
      expect(typeof r.label).toBe("string");
      expect(typeof r.relPath).toBe("string");
      expect(typeof r.passed).toBe("boolean");
      expect(["fatal", "warn"]).toContain(r.severity);
    }
  });

  it("passed + warnings + failed sums equal total checks", () => {
    populateDarwinArtifacts(tmpDir, "arm64");

    const result = runChecks(tmpDir, "darwin", "arm64");

    expect(result.passed + result.warnings + result.failed).toBe(
      result.results.length,
    );
  });

  // -------------------------------------------------------------------------
  // Linux platform
  // -------------------------------------------------------------------------

  it("includes linux-specific check on linux platform", () => {
    const result = runChecks(tmpDir, "linux", "x64");

    const linuxCheck = result.results.find(
      (r: { relPath: string; severity: string }) =>
        r.relPath === "resources/node/linux-x64",
    );
    expect(linuxCheck).toBeDefined();
    expect(linuxCheck?.severity).toBe("fatal");
  });
});

// ---------------------------------------------------------------------------
// Target platform resolution (cross-build support)
// ---------------------------------------------------------------------------

describe("pre-build-check: resolveTargetPlatform", () => {
  it("defaults to the fallback when no flag is given", () => {
    expect(resolveTargetPlatform([], "darwin")).toBe("darwin");
  });

  it("reads --platform <value>", () => {
    expect(resolveTargetPlatform(["--platform", "win32"], "darwin")).toBe(
      "win32",
    );
  });

  it("throws on an unsupported platform", () => {
    expect(() =>
      resolveTargetPlatform(["--platform", "plan9"], "darwin"),
    ).toThrow(/Unsupported platform/);
  });

  it("throws when --platform has no value", () => {
    expect(() => resolveTargetPlatform(["--platform"], "darwin")).toThrow(
      /requires a value/,
    );
  });
});

describe("pre-build-check: cross-build resource validation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails win32 when resources/bin/win32-x64 is missing", () => {
    populateWin32Artifacts(tmpDir);
    // The helper creates this dir (it is fatal now) — remove it to simulate a
    // build machine that never ran prepare:bin.
    fs.rmSync(path.join(tmpDir, "resources/bin/win32-x64/officecli.exe"), {
      recursive: true,
    });

    const { hasFatal, results } = runChecks(tmpDir, "win32");

    expect(
      results.some(
        (r: { relPath: string; passed: boolean }) =>
          r.relPath === "resources/bin/win32-x64/officecli.exe" && !r.passed,
      ),
    ).toBe(true);
    expect(hasFatal).toBe(true);
  });

  it("passes win32 when resources/bin/win32-x64 exists", () => {
    populateWin32Artifacts(tmpDir);

    const { results } = runChecks(tmpDir, "win32");

    expect(
      results.find(
        (r: { relPath: string }) =>
          r.relPath === "resources/bin/win32-x64/officecli.exe",
      )?.passed,
    ).toBe(true);
  });

  it("fails darwin when resources/bin/darwin-<arch> is missing", () => {
    populateDarwinArtifacts(tmpDir, "arm64");
    fs.rmSync(path.join(tmpDir, "resources/bin/darwin-arm64/officecli"), {
      recursive: true,
    });

    const { results } = runChecks(tmpDir, "darwin", "arm64");

    expect(
      results.some(
        (r: { relPath: string; passed: boolean }) =>
          r.relPath === "resources/bin/darwin-arm64/officecli" && !r.passed,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The macOS arch used for validation must match what electron-builder packages
// ---------------------------------------------------------------------------

describe("pre-build-check: macOS target arch agrees with electron-builder.yml", () => {
  it("uses the same arch as mac.target.arch", () => {
    // scripts/pre-build-check.js must validate the arch electron-builder will
    // actually package. That arch is declared in electron-builder.yml, so if
    // someone switches the mac target to x64/universal, this fails instead of
    // letting a build validate the wrong directory and ship without a binary.
    // Parsed with a regex rather than a YAML dependency: the shape is fixed and
    // this only needs to catch a change, not parse YAML in general.
    const builderConfig = fs.readFileSync(
      path.join(__dirname, "..", "..", "electron-builder.yml"),
      "utf8",
    );
    const macBlock = builderConfig.slice(
      builderConfig.indexOf("\nmac:"),
      builderConfig.indexOf("\nlinux:"),
    );
    const arches = [
      ...macBlock.matchAll(/^\s+-\s+(arm64|x64|universal)\s*$/gm),
    ].map((m) => m[1]);

    expect(arches).toContain("arm64");

    const checkSource = fs.readFileSync(
      path.join(__dirname, "..", "..", "scripts", "pre-build-check.js"),
      "utf8",
    );
    const declaredArch = checkSource.match(
      /targetPlatform === 'darwin' \? '(\w+)' : '(\w+)'/,
    );

    expect(declaredArch).not.toBeNull();
    expect(arches).toContain(declaredArch?.[1]);
  });
});
