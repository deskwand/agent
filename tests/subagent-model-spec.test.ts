import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySubagentModelSpec,
  normalizeSubagentModelSpec,
} from "../src/main/agent/subagent/model-spec";

describe("normalizeSubagentModelSpec", () => {
  it("keeps inherit as-is", () => {
    expect(normalizeSubagentModelSpec("inherit")).toBe("inherit");
  });

  it("keeps empty/whitespace as-is", () => {
    expect(normalizeSubagentModelSpec("")).toBe("");
    expect(normalizeSubagentModelSpec("   ")).toBe("");
  });

  it("prefixes bare provider/model with deskwand:", () => {
    expect(normalizeSubagentModelSpec("custom:openai/deepseek-v4-flash")).toBe(
      "deskwand:custom:openai/deepseek-v4-flash",
    );
  });

  it("prefixes plain provider names", () => {
    expect(normalizeSubagentModelSpec("deepseek/deepseek-v4-flash")).toBe(
      "deskwand:deepseek/deepseek-v4-flash",
    );
  });

  it("keeps already-prefixed specs as-is", () => {
    expect(
      normalizeSubagentModelSpec("deskwand:deepseek/deepseek-v4-flash"),
    ).toBe("deskwand:deepseek/deepseek-v4-flash");
  });

  it("keeps bare model names as-is (cannot infer provider)", () => {
    expect(normalizeSubagentModelSpec("deepseek-v4-flash")).toBe(
      "deepseek-v4-flash",
    );
  });

  it("keeps malformed specs without slash as-is", () => {
    expect(normalizeSubagentModelSpec("custom:openai")).toBe("custom:openai");
  });
});

describe("applySubagentModelSpec", () => {
  it("writes deskwand-prefixed spec into existing frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-spec-"));
    const target = join(dir, "general-purpose.md");
    writeFileSync(
      target,
      "---\nname: general-purpose\nmodel: custom:openai/deepseek-v4-flash\nprompt_mode: append\n---\n",
      "utf-8",
    );
    applySubagentModelSpec(target, "custom:openai/deepseek-v4-flash");
    expect(readFileSync(target, "utf-8")).toContain(
      "model: deskwand:custom:openai/deepseek-v4-flash",
    );
  });

  it("keeps inherit unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-spec-"));
    const target = join(dir, "x.md");
    writeFileSync(target, "---\nname: x\nmodel: inherit\n---\n", "utf-8");
    applySubagentModelSpec(target, "inherit");
    expect(readFileSync(target, "utf-8")).toContain("model: inherit");
  });

  it("creates file when missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-spec-"));
    const target = join(dir, "new.md");
    applySubagentModelSpec(target, "deepseek/deepseek-v4-flash");
    expect(readFileSync(target, "utf-8")).toContain(
      "model: deskwand:deepseek/deepseek-v4-flash",
    );
  });

  it("throws when existing file cannot be read (no silent overwrite)", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-spec-"));
    const target = join(dir, "locked.md");
    writeFileSync(
      target,
      "---\nname: locked\ndescription: keep me\nmodel: inherit\n---\nbody\n",
      "utf-8",
    );
    // 目录不可读 → readFileSync 抛 EACCES
    chmodSync(dir, 0o000);
    try {
      expect(() =>
        applySubagentModelSpec(target, "deepseek/deepseek-v4-flash"),
      ).toThrow();
    } finally {
      chmodSync(dir, 0o755);
    }
    // 文件未被覆盖
    expect(readFileSync(target, "utf-8")).toContain("description: keep me");
  });

  it("only edits fields inside the frontmatter block, not body lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-spec-"));
    const target = join(dir, "body.md");
    writeFileSync(
      target,
      "---\nname: body\n---\n\nmodel: this-is-body-text\nthinking: body-thinking\n",
      "utf-8",
    );
    applySubagentModelSpec(target, "deepseek/deepseek-v4-flash", "high");
    const result = readFileSync(target, "utf-8");
    // frontmatter 中插入了 model/thinking
    expect(result).toMatch(
      /^---\nname: body\nmodel: deskwand:deepseek\/deepseek-v4-flash\nthinking: high\n---/,
    );
    // 正文同名行未被改动
    expect(result).toContain("model: this-is-body-text");
    expect(result).toContain("thinking: body-thinking");
  });

  it("handles CRLF frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-spec-"));
    const target = join(dir, "crlf.md");
    writeFileSync(
      target,
      "---\r\nname: crlf\r\nmodel: custom:openai/deepseek-v4-flash\r\nprompt_mode: append\r\n---\r\n",
      "utf-8",
    );
    applySubagentModelSpec(target, "custom:openai/deepseek-v4-flash");
    const result = readFileSync(target, "utf-8");
    expect(result).toContain(
      "model: deskwand:custom:openai/deepseek-v4-flash",
    );
  });
});
