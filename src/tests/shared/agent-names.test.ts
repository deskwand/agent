import { describe, expect, it } from "vitest";
import {
  FALLBACK_AGENT_NAMES,
  agentNameZhLabel,
  isValidAgentName,
  pickFallbackAgentName,
} from "../../shared/agent-names";

describe("isValidAgentName", () => {
  it("接受拉丁字母、数字、下划线与短横线", () => {
    expect(isValidAgentName("turing")).toBe(true);
    expect(isValidAgentName("alan-turing")).toBe(true);
    expect(isValidAgentName("explore-2")).toBe(true);
  });

  it("拒绝中文、空格、首字符是符号与空值", () => {
    expect(isValidAgentName("图灵")).toBe(false);
    expect(isValidAgentName("alan turing")).toBe(false);
    expect(isValidAgentName("-turing")).toBe(false);
    expect(isValidAgentName("")).toBe(false);
    expect(isValidAgentName(undefined)).toBe(false);
  });
});

describe("pickFallbackAgentName", () => {
  it("按随机数落点取名且总在名单内", () => {
    expect(pickFallbackAgentName(() => 0)).toBe(FALLBACK_AGENT_NAMES[0].alias);
    expect(pickFallbackAgentName(() => 0.999)).toBe(
      FALLBACK_AGENT_NAMES[FALLBACK_AGENT_NAMES.length - 1].alias,
    );
  });

  it("兜底名全部满足插件的 handle 语法（^[a-z0-9_-]+$）", () => {
    for (const name of FALLBACK_AGENT_NAMES) {
      expect(name.alias).toMatch(/^[a-z0-9_-]+$/);
      expect(name.zh.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("agentNameZhLabel", () => {
  it("名单内的名字给中文，表外名字不给", () => {
    expect(agentNameZhLabel("turing")).toBe("图灵");
    expect(agentNameZhLabel("auth-audit")).toBeUndefined();
    expect(agentNameZhLabel(undefined)).toBeUndefined();
  });
});
