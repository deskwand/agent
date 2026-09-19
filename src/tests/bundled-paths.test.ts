import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolveBundledNodePaths,
  resolveBundledPythonBinDir,
  resolveBundledBinDir,
  resolveBundledBinDirs,
  type BundleContext,
} from "../main/agent/bundled-paths";

let ctxRoot: string;

beforeEach(() => {
  ctxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bundled-paths-test-"));
});

afterEach(() => {
  fs.rmSync(ctxRoot, { recursive: true, force: true });
});

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "");
}

function mkdirp(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ctxFor(
  overrides: Partial<BundleContext> & Pick<BundleContext, "platform">,
): BundleContext {
  return {
    isPackaged: true,
    resourcesPath: path.join(ctxRoot, "Resources"),
    projectRoot: ctxRoot,
    arch: "arm64",
    ...overrides,
  };
}

describe("resolveBundledBinDir", () => {
  it("returns <resourcesPath>/bin when packaged and it exists", () => {
    const ctx = ctxFor({ platform: "darwin" });
    mkdirp(path.join(ctx.resourcesPath, "bin"));
    expect(resolveBundledBinDir(ctx)).toBe(path.join(ctx.resourcesPath, "bin"));
  });

  it("returns resources/bin/<platform>-<arch> in dev mode", () => {
    const ctx = ctxFor({ platform: "darwin", isPackaged: false });
    const expected = path.join(
      ctx.projectRoot,
      "resources",
      "bin",
      "darwin-arm64",
    );
    mkdirp(expected);
    expect(resolveBundledBinDir(ctx)).toBe(expected);
  });

  it("returns null when the directory does not exist", () => {
    const ctx = ctxFor({ platform: "darwin" });
    expect(resolveBundledBinDir(ctx)).toBeNull();
  });
});

describe("resolveBundledNodePaths", () => {
  it("uses bin/ on unix when packaged", () => {
    const ctx = ctxFor({ platform: "darwin" });
    touch(path.join(ctx.resourcesPath, "node", "bin", "node"));
    touch(path.join(ctx.resourcesPath, "node", "bin", "npx"));
    expect(resolveBundledNodePaths(ctx)).toEqual({
      node: path.join(ctx.resourcesPath, "node", "bin", "node"),
      npx: path.join(ctx.resourcesPath, "node", "bin", "npx"),
    });
  });

  it("uses the root on win32 when packaged", () => {
    const ctx = ctxFor({ platform: "win32" });
    touch(path.join(ctx.resourcesPath, "node", "node.exe"));
    touch(path.join(ctx.resourcesPath, "node", "npx.cmd"));
    expect(resolveBundledNodePaths(ctx)).toEqual({
      node: path.join(ctx.resourcesPath, "node", "node.exe"),
      npx: path.join(ctx.resourcesPath, "node", "npx.cmd"),
    });
  });

  it("reads resources/node/<platform>-<arch> in dev mode", () => {
    const ctx = ctxFor({ platform: "darwin", isPackaged: false });
    const base = path.join(
      ctx.projectRoot,
      "resources",
      "node",
      "darwin-arm64",
      "bin",
    );
    touch(path.join(base, "node"));
    touch(path.join(base, "npx"));
    expect(resolveBundledNodePaths(ctx)?.node).toBe(path.join(base, "node"));
  });

  it("returns null when node is missing", () => {
    const ctx = ctxFor({ platform: "darwin" });
    expect(resolveBundledNodePaths(ctx)).toBeNull();
  });
});

describe("resolveBundledPythonBinDir", () => {
  it("returns <resourcesPath>/python/bin when packaged", () => {
    const ctx = ctxFor({ platform: "darwin" });
    const binDir = path.join(ctx.resourcesPath, "python", "bin");
    touch(path.join(binDir, "python3"));
    expect(resolveBundledPythonBinDir(ctx)).toBe(binDir);
  });

  it("returns null when python3 is missing", () => {
    const ctx = ctxFor({ platform: "darwin" });
    expect(resolveBundledPythonBinDir(ctx)).toBeNull();
  });
});

describe("resolveBundledBinDirs", () => {
  it("returns only the directories that exist", () => {
    const ctx = ctxFor({ platform: "darwin" });
    mkdirp(path.join(ctx.resourcesPath, "bin"));
    expect(resolveBundledBinDirs(ctx)).toEqual([
      path.join(ctx.resourcesPath, "bin"),
    ]);
  });

  it("returns an empty array when nothing is bundled", () => {
    const ctx = ctxFor({ platform: "darwin" });
    expect(resolveBundledBinDirs(ctx)).toEqual([]);
  });

  it("returns bin before node and python so bundled helpers win on PATH", () => {
    const ctx = ctxFor({ platform: "darwin" });
    mkdirp(path.join(ctx.resourcesPath, "bin"));
    touch(path.join(ctx.resourcesPath, "node", "bin", "node"));
    touch(path.join(ctx.resourcesPath, "node", "bin", "npx"));
    touch(path.join(ctx.resourcesPath, "python", "bin", "python3"));
    const dirs = resolveBundledBinDirs(ctx);
    expect(dirs[0]).toBe(path.join(ctx.resourcesPath, "bin"));
    expect(dirs).toContain(path.join(ctx.resourcesPath, "node", "bin"));
    expect(dirs).toContain(path.join(ctx.resourcesPath, "python", "bin"));
  });
});
