import { describe, expect, it } from "vitest";
import {
  parseUserTokenValue,
  resolveLeadingToken,
  stripLeadingSkillToken,
  toUserMarkdown,
  USER_TOKEN_SENTINEL,
} from "../../renderer/utils/reference-tokens";

const NO_COMMANDS = new Map<string, string>();
const WITH_PLAN = new Map([["plan", "/plan"]]);

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
      label: "apple-design",
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
      label: "apple-design",
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
    // 内置命令：没有显示名时 label 回退成含斜杠的原文
    expect(resolveLeadingToken("/compact", NO_COMMANDS)).toEqual({
      kind: "command",
      name: "compact",
      raw: "/compact",
      label: "/compact",
    });
    expect(resolveLeadingToken("/plan 做一遍", WITH_PLAN)).toEqual({
      kind: "command",
      name: "plan",
      raw: "/plan",
      label: "/plan",
    });
    // 集合里没有就不是命令 —— 退化为纯文本，不误判
    expect(resolveLeadingToken("/plan 做一遍", NO_COMMANDS)).toBeNull();
  });

  it("技能前缀优先于命令分支", () => {
    expect(
      resolveLeadingToken("/skill:foo", new Map([["skill:foo", "/skill:foo"]]))
        ?.kind,
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

describe("resolveLeadingToken · 显示名", () => {
  it("有显示名时 label 用显示名，raw 保持 /slug", () => {
    const labels = new Map([["translate", "翻译成英文"]]);
    const token = resolveLeadingToken("/translate 这段话", labels);
    expect(token?.label).toBe("翻译成英文");
    expect(token?.raw).toBe("/translate");
  });
});

describe("stripLeadingSkillToken", () => {
  it("剥掉行首技能令牌", () => {
    expect(stripLeadingSkillToken("/skill:pdf")).toBe("");
    expect(stripLeadingSkillToken("/skill:pdf 读一下这份")).toBe(" 读一下这份");
    expect(stripLeadingSkillToken("/skill:pdf\n读一下")).toBe("\n读一下");
  });

  it("命令令牌原样保留 —— /goal 单独发是合法的", () => {
    expect(stripLeadingSkillToken("/goal")).toBe("/goal");
    expect(stripLeadingSkillToken("/compact")).toBe("/compact");
  });

  it("句中出现的 /skill: 不动 —— 只有行首才是令牌", () => {
    expect(stripLeadingSkillToken("帮我用 /skill:pdf 改")).toBe(
      "帮我用 /skill:pdf 改",
    );
    expect(stripLeadingSkillToken("第一行\n/skill:pdf")).toBe(
      "第一行\n/skill:pdf",
    );
  });

  it("没有技能名的 /skill: 是普通文本，不动", () => {
    expect(stripLeadingSkillToken("/skill:")).toBe("/skill:");
  });

  it("空串与空白原样返回", () => {
    expect(stripLeadingSkillToken("")).toBe("");
    expect(stripLeadingSkillToken("   ")).toBe("   ");
  });
});

describe("toUserMarkdown", () => {
  const labels = new Map([["plan", "/plan 计划"]]);

  it("行首技能变成哨兵 code span，正文（含原有空格）原样跟在后面", () => {
    const out = toUserMarkdown("/skill:apple-design 把间距统一一下", labels);
    expect(out.startsWith("`" + USER_TOKEN_SENTINEL)).toBe(true);
    // raw 不含尾随空格（SKILL_PATTERN 是 (\S+)），所以这里有一个空格
    expect(out.endsWith("` 把间距统一一下")).toBe(true);
    expect(out).not.toContain("/skill:");
    const value = /^`([^`]+)`/.exec(out)?.[1] ?? "";
    expect(parseUserTokenValue(value)).toEqual({
      kind: "skill",
      label: "apple-design",
      raw: "/skill:apple-design",
    });
  });

  it("行首命令保留原文，供 chip 的 tooltip 使用", () => {
    const out = toUserMarkdown("/plan 排一下", labels);
    const value = /^`([^`]+)`/.exec(out)?.[1] ?? "";
    expect(parseUserTokenValue(value)).toEqual({
      kind: "command",
      label: "/plan 计划",
      raw: "/plan",
    });
  });

  it("技能名带点或中文也认得出来", () => {
    const out = toUserMarkdown("/skill:技能名 改", labels);
    const value = /^`([^`]+)`/.exec(out)?.[1] ?? "";
    expect(parseUserTokenValue(value)?.label).toBe("技能名");
  });

  it("句中 /skill: 与普通文本原样返回（含换行）", () => {
    expect(toUserMarkdown("帮我用 /skill:x 改", labels)).toBe(
      "帮我用 /skill:x 改",
    );
    expect(toUserMarkdown("/tmp 目录\n第二行", labels)).toBe(
      "/tmp 目录\n第二行",
    );
  });

  it("行首非白名单命令 /word 保持纯文本", () => {
    expect(toUserMarkdown("/unknown 收一下", labels)).toBe("/unknown 收一下");
  });

  it("载荷里的反引号被剥掉，不会撑破 code span", () => {
    const out = toUserMarkdown("/skill:a`b 改", labels);
    const value = /^`([^`]+)`/.exec(out)?.[1] ?? "";
    expect(value).not.toContain("`");
    expect(parseUserTokenValue(value)?.label).toBe("ab");
  });

  it("parseUserTokenValue 对任何输入都不抛，且不认残缺载荷", () => {
    expect(parseUserTokenValue("普通文本")).toBeNull();
    expect(parseUserTokenValue(USER_TOKEN_SENTINEL)).toBeNull();
    expect(
      parseUserTokenValue(USER_TOKEN_SENTINEL + "|x|%E0%A4%A|y|"),
    ).toBeNull();
  });
});
