import { describe, expect, it } from "vitest";
import {
  filterCommands,
  toSlashCommands,
  type SlashCommand,
} from "../../renderer/slash-commands";

const dto = [
  { name: "compact", description: "压缩", source: "builtin" as const },
  { name: "plan", description: "计划", source: "extension" as const },
  {
    name: "translate",
    description: "翻英文",
    source: "prompt" as const,
    displayName: "翻译成英文",
    editable: true,
  },
  { name: "weekly", description: "周报", source: "prompt" as const, editable: true },
];

describe("toSlashCommands", () => {
  it("模板映射成 prompt 动作并带上显示名", () => {
    const commands = toSlashCommands(dto);
    const translate = commands.find((c) => c.name === "translate");
    expect(translate?.source).toBe("prompt");
    expect(translate?.action).toBe("prompt");
    expect(translate?.displayName).toBe("翻译成英文");
    // 没有显示名的模板 displayName 为空，菜单行与 chip 都回退到命令名
    const weekly = commands.find((c) => c.name === "weekly");
    expect(weekly?.displayName).toBeUndefined();
  });

  it("内置与扩展命令的映射不变", () => {
    const commands = toSlashCommands(dto);
    expect(commands.find((c) => c.name === "compact")?.action).toBe("compact");
    expect(commands.find((c) => c.name === "plan")?.action).toBe("extension");
  });
});

describe("filterCommands", () => {
  const base: SlashCommand[] = toSlashCommands(dto);

  it("按 slug 前缀匹配（现有行为）", () => {
    expect(filterCommands(base, "tra").map((c) => c.name)).toEqual(["translate"]);
  });

  it("也按显示名子串匹配，中文能搜到", () => {
    expect(filterCommands(base, "翻译").map((c) => c.name)).toEqual(["translate"]);
    expect(filterCommands(base, "英文").map((c) => c.name)).toEqual(["translate"]);
  });

  it("空过滤返回全部", () => {
    expect(filterCommands(base, "")).toHaveLength(base.length);
  });

  it("扩展命令不走显示名匹配（没有该字段）", () => {
    expect(filterCommands(base, "计划")).toEqual([]);
  });
});
