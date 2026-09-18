import { describe, expect, it } from "vitest";
import { resolveLeadingToken } from "../../renderer/utils/reference-tokens";

const NO_COMMANDS = new Set<string>();
const WITH_PLAN = new Set(["plan"]);

describe("resolveLeadingToken", () => {
  it("行首技能命中，name 不含 /skill: 前缀", () => {
    expect(
      resolveLeadingToken(
        "/skill:apple-design 帮我把间距统一一下",
        NO_COMMANDS,
      ),
    ).toEqual({
      kind: "skill",
      name: "apple-design",
      raw: "/skill:apple-design",
    });
  });

  it("技能名含点和中文也命中（对齐 pi 的 [^\\s]+，不是自造的字符集）", () => {
    expect(resolveLeadingToken("/skill:pdf.js 改", NO_COMMANDS)?.name).toBe(
      "pdf.js",
    );
    expect(resolveLeadingToken("/skill:技能名 改", NO_COMMANDS)?.name).toBe(
      "技能名",
    );
  });

  it("技能名可以不跟参数", () => {
    expect(resolveLeadingToken("/skill:apple-design", NO_COMMANDS)).toEqual({
      kind: "skill",
      name: "apple-design",
      raw: "/skill:apple-design",
    });
  });

  it("句中出现的 /skill: 不是技能调用（pi 只在开头展开）", () => {
    expect(
      resolveLeadingToken("帮我用 /skill:apple-design 改", NO_COMMANDS),
    ).toBeNull();
    expect(resolveLeadingToken("第一行\n/skill:x", NO_COMMANDS)).toBeNull();
  });

  it("行首的 /tmp、and/or 不命中（不是命令）", () => {
    expect(resolveLeadingToken("/tmp 目录下的文件", NO_COMMANDS)).toBeNull();
    expect(resolveLeadingToken("and/or foo", NO_COMMANDS)).toBeNull();
    expect(resolveLeadingToken("2024/12 月", NO_COMMANDS)).toBeNull();
  });

  it("命令必须命中集合：内置与扩展命令名都算", () => {
    expect(resolveLeadingToken("/compact", NO_COMMANDS)).toEqual({
      kind: "command",
      name: "compact",
      raw: "/compact",
    });
    expect(resolveLeadingToken("/plan 做一遍", WITH_PLAN)).toEqual({
      kind: "command",
      name: "plan",
      raw: "/plan",
    });
    // 集合里没有就不是命令 —— 退化为纯文本，不误判
    expect(resolveLeadingToken("/plan 做一遍", NO_COMMANDS)).toBeNull();
  });

  it("技能前缀优先于命令分支", () => {
    expect(
      resolveLeadingToken("/skill:foo", new Set(["skill:foo"]))?.kind,
    ).toBe("skill");
  });

  it("只认第一个 token：第二个靠调用方 slice(raw.length) 留在剩余文本里", () => {
    const token = resolveLeadingToken("/skill:a /skill:b", NO_COMMANDS);
    expect(token?.raw).toBe("/skill:a");
    expect("/skill:a /skill:b".slice(token!.raw.length)).toBe(" /skill:b");
  });

  it("空串与不完整前缀不命中", () => {
    expect(resolveLeadingToken("", NO_COMMANDS)).toBeNull();
    expect(resolveLeadingToken("/skill:", NO_COMMANDS)).toBeNull();
    expect(resolveLeadingToken("/", NO_COMMANDS)).toBeNull();
  });
});
