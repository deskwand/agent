import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src/main/agent/agent-runner.ts"),
  "utf8",
);

describe("powershell 后台化接线", () => {
  it("显式构造 powershell 工具定义（内置不在 createCodingToolDefinitions 里）", () => {
    expect(src).toContain("createPowerShellToolDefinition");
  });

  it("powershell 与 bash 走同一个背景包装", () => {
    expect(src).toMatch(
      /backgroundTools\.find\(\s*\(t\) => t\.name === "powershell",?\s*\)/,
    );
  });

  it("powershell 只在 Windows 上构造，其它平台不注册", () => {
    expect(src).toContain('process.platform === "win32"');
  });
});
