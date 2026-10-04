import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendVoiceSection,
  resolveTurnThinkingLevel,
  VOICE_PROMPT_SECTION,
  VOICE_TURN,
} from "../../main/agent/turn-profiles";

describe("voice turn profile", () => {
  it("keeps exactly the three search tools", () => {
    expect(VOICE_TURN.tools).toEqual([
      "web_search",
      "fetch_content",
      "get_search_content",
    ]);
  });

  // 这不是在钉当前值，而是在钉本次精简的意图：read 会把 163 个技能的段落
  // 拽回系统提示词（约 6K token），office_read_* 与 vision_describe 语音里没有出口。
  it("keeps read, office readers and vision out of the voice list", () => {
    for (const name of [
      "read",
      "bash",
      "office_read_docx",
      "office_read_pdf",
      "office_read_pptx",
      "office_read_xlsx",
      "vision_describe",
      "tts",
      "ask_user",
      "todo_write",
    ]) {
      expect(VOICE_TURN.tools).not.toContain(name);
    }
  });

  it("turns thinking off", () => {
    expect(VOICE_TURN.thinkingLevel).toBe("off");
  });

  it("ships a voice_mode section", () => {
    expect(VOICE_PROMPT_SECTION.trim().length).toBeGreaterThan(0);
    expect(VOICE_PROMPT_SECTION).toContain("<voice_mode>");
    expect(VOICE_PROMPT_SECTION).toContain("</voice_mode>");
  });

  // 名字写错等于工具静默失效（设计 §8 风险表）。注册名有变动时这条先红。
  it("every allowlisted name is a real registered tool name", () => {
    const registered = [
      "read",
      "bash",
      "edit",
      "write",
      "web_search",
      "fetch_content",
      "get_search_content",
      "vision_describe",
      "tts",
      "ask_user",
      "todo_write",
      "office_read_docx",
      "office_read_pdf",
      "office_read_pptx",
      "office_read_xlsx",
    ];
    for (const name of VOICE_TURN.tools) {
      expect(registered).toContain(name);
    }
  });

  // 文字轮必须原样不动。
  it("leaves the prompt untouched on a text turn", () => {
    expect(appendVoiceSection("base", undefined)).toBe("base");
  });
});

describe("AgentRunner wiring", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../main/agent/agent-runner.ts"),
    "utf-8",
  );

  it("takes the turn profile from the new flag, not the old boolean", () => {
    expect(src).toContain("resolveSessionTurnPolicy(");
    expect(src).toContain("applySessionTurnPolicyToSdk(");
    expect(src).not.toContain("resolveActiveTools");
  });

  it("derives the effective thinking level from the profile", () => {
    expect(resolveTurnThinkingLevel(VOICE_TURN, "high")).toBe("off");
    expect(resolveTurnThinkingLevel(undefined, "high")).toBe("high");
  });

  it("registers the turn profile extension once per session", () => {
    expect(src).toContain("createTurnProfileExtension(");
  });

  it("stores the profile on the cached session every turn", () => {
    expect(src).toContain("sessionRecord.turnProfile = profile");
  });
});
