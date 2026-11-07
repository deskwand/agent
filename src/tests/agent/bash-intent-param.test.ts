import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createCodingTools } from "@earendil-works/pi-coding-agent";
import { Compile } from "typebox/compile";
import { withBashIntentParam } from "../../main/agent/bash-intent-param";

interface SchemaShape {
  type: string;
  properties: Record<string, { type?: string; maxLength?: number }>;
  required?: string[];
}

function schemaOf(tool: { parameters: unknown }): SchemaShape {
  return tool.parameters as SchemaShape;
}

const tools = createCodingTools(process.cwd());
const out = withBashIntentParam(tools);
const bash = out.find((tool) => tool.name === "bash")!;
const read = out.find((tool) => tool.name === "read")!;

describe("withBashIntentParam", () => {
  it("给 bash 加可选 description，保留原有 command / timeout", () => {
    const schema = schemaOf(bash);
    expect(schema.type).toBe("object");
    expect(schema.properties.command?.type).toBe("string");
    expect(schema.properties.timeout).toBeDefined();
    expect(schema.properties.description?.type).toBe("string");
    expect(schema.required ?? []).not.toContain("description");
    expect(schema.required ?? []).toContain("command");
  });

  it("description 有长度上限，避免模型贴一整段话进行头", () => {
    expect(schemaOf(bash).properties.description?.maxLength).toBe(160);
  });

  // pi 的 bash schema 用 typebox v1，agent-runner 里用的是 @sinclair/typebox v0.34。
  // 重新 Type.Object 一遍会把 v1 的 optional 标记吞掉，timeout 变成必填 —— 而不带 timeout
  // 正是常态（默认 120s 是包装层在 execute 里补的，校验在前）。这两条钉住它。
  it("不把 timeout 变成必填", () => {
    const schema = schemaOf(bash);
    expect(schema.required ?? []).toContain("command");
    expect(schema.required ?? []).not.toContain("timeout");
  });

  it("pi 的校验接受只带 command 的调用，且仍然要求 command", () => {
    const compiled = Compile(bash.parameters as never);
    expect(compiled.Check({ command: "ls" } as never)).toBe(true);
    expect(compiled.Check({} as never)).toBe(false);
  });

  it("非 bash 工具原样返回（同一个对象引用）", () => {
    const before = tools.find((tool) => tool.name === "read");
    expect(read).toBe(before);
  });

  it("执行函数不被替换：只是加参数，不改行为", () => {
    const before = tools.find((tool) => tool.name === "bash")!;
    expect(bash.execute).toBe(before.execute);
  });

  it("agent-runner 把包装接进了 bash 链路", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../main/agent/agent-runner.ts"),
      "utf-8",
    );
    expect(src).toContain("withBashIntentParam(");
    expect(src).toContain('from "./bash-intent-param"');
  });
});
