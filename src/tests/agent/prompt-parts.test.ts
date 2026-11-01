import { describe, expect, it } from "vitest";
import {
  measurePromptParts,
  measureSessionPromptParts,
} from "../../main/agent/prompt-parts";
import { VOICE_PROMPT_SECTION } from "../../main/agent/turn-profiles";

const ascii = (n: number) => "a".repeat(n);

describe("measurePromptParts", () => {
  it("把系统提示词、工具声明、技能段分开量", () => {
    const parts = measurePromptParts({
      // 真实形状：<skills> 与 </skills> 各自独占一行
      systemPrompt: `<preamble>${ascii(400)}</preamble>\n<skills>\n${ascii(400)}\n</skills>`,
      tools: [{ name: "read", description: ascii(400), parameters: {} }],
    });

    expect(parts.promptTokens).toBeGreaterThan(100);
    expect(parts.skillTokens).toBeGreaterThanOrEqual(100);
    expect(parts.toolTokens).toBeGreaterThan(100);
  });

  it("技能段不会在系统提示词里被算第二遍", () => {
    const prompt = `<preamble>${ascii(400)}</preamble>`;
    const withSkills = measurePromptParts({
      systemPrompt: `${prompt}\n<skills>\n${ascii(400)}\n</skills>`,
      tools: [],
    });
    const withoutSkills = measurePromptParts({
      systemPrompt: prompt,
      tools: [],
    });

    expect(withSkills.promptTokens).toBe(withoutSkills.promptTokens);
    expect(withSkills.skillTokens).toBeGreaterThanOrEqual(100);
  });

  it("没有工具时工具那一块是 0，不是 NaN", () => {
    const parts = measurePromptParts({ systemPrompt: ascii(400), tools: [] });
    expect(parts.toolTokens).toBe(0);
    expect(Number.isFinite(parts.promptTokens)).toBe(true);
  });

  it("参数 schema 序列化不了时不抛，只少算这一块", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const parts = measurePromptParts({
      systemPrompt: "",
      tools: [{ name: "loop", description: ascii(40), parameters: circular }],
    });
    expect(parts.toolTokens).toBeGreaterThan(0);
  });

  it("技能段按行锚定：AGENTS.md 里出现字面 <skills> 不会切错", () => {
    // project_context 排在 skills 前面，一份正文里写了 <skills> 的文件是真实风险：
    // 不锚定的话非贪婪匹配会从那里切开，把真提示词当成技能段算。
    const realSkills = [
      "<skills>",
      "The following skills provide specialized instructions.",
      "<available_skills>",
      "  <skill><name>ste</name></skill>",
      "</skills>",
    ].join("\n");
    const prompt = [
      "<project_context>",
      "see the <skills> tag docs",
      "</project_context>",
      realSkills,
    ].join("\n");

    const parts = measurePromptParts({ systemPrompt: prompt, tools: [] });

    expect(parts.skillTokens).toBeGreaterThan(0);
    // 技能段里只有那几行；提示词要把 project_context 全留着
    expect(parts.promptTokens).toBeGreaterThanOrEqual(
      Math.floor(
        "<project_context>\nsee the <skills> tag docs\n</project_context>"
          .length / 4,
      ),
    );
  });

  it("把当轮追加的段（语音）算进系统提示词", () => {
    const base = measurePromptParts({ systemPrompt: ascii(400), tools: [] });
    const withVoice = measurePromptParts({
      systemPrompt: ascii(400),
      tools: [],
      promptSuffix: VOICE_PROMPT_SECTION,
    });

    // SDK 的 systemPrompt 两次 run 之间回到 base，forced prompt 只能这样补上
    expect(withVoice.promptTokens).toBeGreaterThan(base.promptTokens + 100);
  });

  it("只量真正声明给模型的工具（deferred / codemode 的没声明就不算）", () => {
    const parts = measureSessionPromptParts({
      systemPrompt: "",
      getActiveToolNames: () => ["read"],
      getAllTools: () => [
        { name: "read", description: ascii(400) },
        { name: "mcp__never_declared", description: ascii(4_000) },
      ],
    });
    const readOnly = measurePromptParts({
      systemPrompt: "",
      tools: [{ name: "read", description: ascii(400) }],
    });

    expect(parts).toEqual(readOnly);
  });
});
