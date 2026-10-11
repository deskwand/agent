import { afterEach, describe, expect, it } from "vitest";
import { Lightbulb } from "lucide-react";
import i18n from "../../renderer/i18n/config";
import {
  getToolIcon,
  getToolLabel,
} from "../../renderer/components/message/toolHelpers";

afterEach(async () => {
  await i18n.changeLanguage("zh");
});

describe("idea 工具的详情图标与标签", () => {
  it.each(["idea_search", "idea_read", "idea_add"])("%s 用灯泡图标", (name) => {
    expect(getToolIcon(name).type).toBe(Lightbulb);
  });

  it("有参数时标签说清操作对象（中文）", async () => {
    await i18n.changeLanguage("zh");
    expect(getToolLabel("idea_search", { query: "密库" }, i18n.t)).toBe(
      "查阅想法：密库",
    );
    expect(
      getToolLabel("idea_read", { name: "2026-10-11-abc.md" }, i18n.t),
    ).toBe("读取想法 2026-10-11-abc.md");
    expect(getToolLabel("idea_add", { content: "记一条" }, i18n.t)).toBe(
      "记录想法：记一条",
    );
  });

  it("没有参数时退化成动作名，超长内容截断（英文）", async () => {
    await i18n.changeLanguage("en");
    expect(getToolLabel("idea_search", {}, i18n.t)).toBe("Search ideas");
    expect(getToolLabel("idea_read", {}, i18n.t)).toBe("Read idea");
    expect(getToolLabel("idea_add", { content: "a".repeat(40) }, i18n.t)).toBe(
      `Recorded idea: ${"a".repeat(27)}…`,
    );
  });
});
