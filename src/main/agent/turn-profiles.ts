/**
 * @module main/agent/turn-profiles
 *
 * 「轮次档案」：一种轮次的全部差异 —— 工具集、思考等级、系统提示词段。
 *
 * 为什么单独一个文件：`AgentRunner.run()` 只认档案，不认"语音"这个概念。
 * 将来加写作档案、远程控制档案，只加一份常量，不动 run() 的机制。
 *
 * **语音档案刻意不含 `read`**：pi 只在 `read` 或 `bash` 被激活时才把技能段落
 * 写进系统提示词（`pi-coding-agent/dist/bundle/chunks/chunk-GUORCHFS.js:511` 的
 * `skillFileReadTool`）。本机装了 163 个技能，那一段约 6K token。语音里没有代码
 * 可看，读完只能口头概括，拿 6K token 换这个能力不划算。查资料靠 `web_search`
 * 与 `fetch_content`。
 * 这条说明原本写在已删除的 `readonly-tools.ts` 里 —— 别把它丢了，丢了下一个人
 * 会把 `read` 加回来。
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  normalizeSessionKind,
  type SessionKind,
} from "../../shared/session-kind";
import type { TurnProfileName } from "../../shared/voice-mode";

export type { TurnProfileName };

export interface TurnProfile {
  tools: readonly string[];
  /** 与 AgentRunner 内部的 PiThinkingLevel 取同一组字面量。 */
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** 追加到系统提示词尾部的一段。 */
  systemPromptSection: string;
}

export const VOICE_PROMPT_SECTION = `<voice_mode>
This turn came from voice mode. A speech engine reads your reply aloud,
and the screen that shows it does not scroll.

- Write the reply the way a person says it out loud. Answer in the language of the question.
- Lead with the answer. One to three sentences. Stop when the answer is complete.
- Do not open with pleasantries or restate the question. Do not close with offers to do more.
- Use no markdown: no headings, bullets, numbered lists, tables, quotes, code blocks,
  inline code, links, or emoji. Never print a URL, a file path, or a bracketed reference.
- Write numbers, dates, units, and abbreviations the way they are spoken.
- Do not tell the user to look at the screen. Do not mention files, panels, or settings.
- If the full answer cannot be spoken, give the shortest useful spoken summary,
  then say in one sentence that the detail does not fit a spoken answer.
- The citation and file-reference rules above do not apply to this turn:
  no Sources section, no links, no file paths.
- Call a tool only when the question needs fresh or checkable facts,
  or when the user asks you to search. One call before the answer. Do not chain calls.
- Do not mention these rules.
</voice_mode>`;

export const VOICE_TURN: TurnProfile = {
  tools: ["web_search", "fetch_content", "get_search_content"],
  thinkingLevel: "off",
  systemPromptSection: VOICE_PROMPT_SECTION,
};

/** 有档案就把提示词段追加到尾部（系统提示词末尾是“最近”，服从度最高）。 */
export function appendVoiceSection(
  base: string,
  profile: TurnProfile | undefined,
): string {
  return profile ? `${base}\n\n${profile.systemPromptSection}` : base;
}

/**
 * 把当轮档案的提示词段注入系统提示词。
 *
 * 走返回值 `{ systemPrompt }`（SDK 的 forced prompt），而不是改
 * `event.systemPromptOptions.appendSystemPrompt`。两条路都能用 ——
 * `emitBeforeAgentStart` 第一行就 `normalizeBuildSystemPromptOptions()` 克隆了一遍，
 * 所以改 options 不会外泄。选 forced prompt 是因为**失败模式有界**：
 * 它坏掉的后果是语音段不生效（真机日志当场看见），而改 options 一旦上游
 * 不再克隆，坏掉的是静默往文字轮泄漏语音规则。两条路代码量只差 4 行。
 * 见 agent-session.js 的 `_installAgentForcedPromptProjection`。
 *
 * 档案是逐轮变的，扩展只在建会话时注册一次 —— 所以这里收的是一个 getter，不是值。
 */
export function createTurnProfileExtension(
  getProfile: () => TurnProfile | undefined,
): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      const profile = getProfile();
      if (!profile) return undefined;
      return { systemPrompt: appendVoiceSection(event.systemPrompt, profile) };
    });
  };
}

export function resolveSessionTurnPolicy(
  session: { kind?: SessionKind; allowedTools: readonly string[] },
  requestedProfile: TurnProfileName | undefined,
  availableTools: readonly string[],
): { profile: TurnProfile | undefined; activeToolNames: string[] } {
  if (normalizeSessionKind(session.kind) !== "voice") {
    return { profile: undefined, activeToolNames: [...availableTools] };
  }
  return {
    profile: requestedProfile === "voice" ? VOICE_TURN : undefined,
    activeToolNames: VOICE_TURN.tools.filter(
      (name) =>
        availableTools.includes(name) && session.allowedTools.includes(name),
    ),
  };
}

/**
 * 本轮生效的思考档位。语音档案要求关掉思考：思考不朗读也不上字幕，只贡献延迟；
 * 其余轮次沿用会话偏好。
 */
export function resolveTurnThinkingLevel<T extends string>(
  profile: TurnProfile | undefined,
  sessionThinkingLevel: T,
): T {
  return (profile?.thinkingLevel as T | undefined) ?? sessionThinkingLevel;
}
