import { describe, it, expect } from "vitest";
import {
  filterCommands,
  toSlashCommands,
  type SlashCommand,
} from "../../renderer/slash-commands";

describe("filterCommands", () => {
  const cmds: SlashCommand[] = [
    {
      name: "plan",
      label: "Plan",
      description: "d",
      action: "extension",
      source: "extension",
    },
    {
      name: "todos",
      label: "Todos",
      description: "d",
      action: "extension",
      source: "extension",
    },
    {
      name: "compact",
      label: "Compact",
      description: "d",
      action: "compact",
      source: "builtin",
    },
  ];

  it("matches by exact prefix", () => {
    expect(filterCommands(cmds, "plan").map((c) => c.name)).toEqual(["plan"]);
    expect(filterCommands(cmds, "pl").map((c) => c.name)).toEqual(["plan"]);
  });

  it("empty filter returns all", () => {
    expect(filterCommands(cmds, "").map((c) => c.name)).toEqual([
      "plan",
      "todos",
      "compact",
    ]);
  });

  it("no substring matching for commands", () => {
    // "plan" contains "an" but does not start with it
    expect(filterCommands(cmds, "an")).toEqual([]);
  });

  it("matches case-insensitively in both directions", () => {
    // 大写输入匹配小写命令名
    expect(filterCommands(cmds, "PLAN").map((c) => c.name)).toEqual(["plan"]);
    // 小写输入匹配大写命令名
    const mixed = [
      { name: "GitStatus", label: "G", description: "d", action: "extension" as const, source: "extension" as const },
    ];
    expect(filterCommands(mixed, "git").map((c) => c.name)).toEqual(["GitStatus"]);
    expect(filterCommands(mixed, "gits").map((c) => c.name)).toEqual(["GitStatus"]);
  });
});

describe("toSlashCommands", () => {
  it("maps extension entries to extension action", () => {
    const mapped = toSlashCommands([
      { name: "plan", description: "Plan mode", source: "extension" },
    ]);
    expect(mapped).toEqual([
      {
        name: "plan",
        label: "plan",
        description: "Plan mode",
        action: "extension",
        source: "extension",
      },
    ]);
  });

  it("maps builtin entries to their name action", () => {
    const mapped = toSlashCommands([
      { name: "compact", source: "builtin" },
      { name: "goal", source: "builtin" },
    ]);
    expect(mapped.map((c) => c.action)).toEqual(["compact", "goal"]);
  });
});
