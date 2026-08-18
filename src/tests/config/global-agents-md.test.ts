import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getGlobalAgentsMdPath,
  readGlobalAgentsMd,
  writeGlobalAgentsMd,
  buildAgentsFilesOverride,
} from "../../main/config/global-agents-md";

const state = vi.hoisted(() => ({ mockHome: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof os;
  return { ...actual, homedir: () => state.mockHome };
});

describe("global-agents-md", () => {
  beforeEach(() => {
    state.mockHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "global-agents-md-"),
    );
  });

  it("resolves the path under ~/.deskwand", () => {
    expect(getGlobalAgentsMdPath()).toBe(
      path.join(state.mockHome, ".deskwand", "AGENTS.md"),
    );
  });

  it("read returns null when the file does not exist", () => {
    expect(readGlobalAgentsMd()).toBeNull();
  });

  it("read returns path and content when the file exists", () => {
    const p = getGlobalAgentsMdPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "# hello", "utf-8");
    expect(readGlobalAgentsMd()).toEqual({ path: p, content: "# hello" });
  });

  it("write creates directories and writes atomically", () => {
    const result = writeGlobalAgentsMd("# rules");
    expect(result).toEqual({ ok: true });
    expect(fs.readFileSync(getGlobalAgentsMdPath(), "utf-8")).toBe("# rules");
    expect(fs.existsSync(`${getGlobalAgentsMdPath()}.tmp`)).toBe(false);
  });

  it("write returns ok:false and cleans tmp on rename failure", () => {
    const target = getGlobalAgentsMdPath();
    fs.mkdirSync(target, { recursive: true }); // 目标已存在且是目录 → rename 必失败
    const result = writeGlobalAgentsMd("# rules");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("override prepends global file when non-empty", () => {
    const p = getGlobalAgentsMdPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "# global", "utf-8");
    const override = buildAgentsFilesOverride();
    const base = {
      agentsFiles: [{ path: "/proj/AGENTS.md", content: "# project" }],
    };
    expect(override(base).agentsFiles).toEqual([
      { path: p, content: "# global" },
      { path: "/proj/AGENTS.md", content: "# project" },
    ]);
  });

  it("override returns base unchanged when file missing or blank", () => {
    const override = buildAgentsFilesOverride();
    const base = {
      agentsFiles: [{ path: "/proj/AGENTS.md", content: "# project" }],
    };
    expect(override(base)).toBe(base); // missing → 原对象原样返回
    const p = getGlobalAgentsMdPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "   \n", "utf-8"); // blank
    expect(override(base).agentsFiles).toEqual(base.agentsFiles);
  });
});
