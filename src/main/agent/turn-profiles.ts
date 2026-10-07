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
This turn is spoken aloud by a speech engine, and the screen showing it does not scroll.
Write what a person would say, not what a person would read.

- Answer in the language of the question. Lead with the answer. One to three sentences, then stop.
- Do not open with pleasantries or restate the question. Do not close with offers to do more.
- Plain spoken prose only: no markdown, no headings, bullets, numbered lists, tables, quotes,
  code blocks, inline code, file paths, emoji, or bracketed references.
- Never output a sources list, a reference list, or a citation of any kind, and never say where
  the information came from. Source lines a tool gives you are for your own reading only: read
  them, then answer without repeating, listing, or mentioning them.
- Never output a link, a URL, or a domain name, not even inside a sentence.
- Write numbers, dates, units, and abbreviations the way they are spoken.
- Do not tell the user to look at the screen. Do not mention files, panels, settings, or tools.
- If the full answer cannot be spoken, give the shortest useful spoken summary,
  then say in one sentence that the detail does not fit a spoken answer.
- web_search, fetch_content and get_search_content are your research tools: call one of them once
  when the question needs fresh or checkable facts, or when the user asks you to search, then
  answer. Do not chain calls. Ignore every other tool you may be able to see.
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
  if (!isVoiceSession(session)) {
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

/** 会话是不是语音会话。提示词过滤与工具形态都用它，别在别处再写一遍这个判断。 */
export function isVoiceSession(session: { kind?: SessionKind }): boolean {
  return normalizeSessionKind(session.kind) === "voice";
}

/**
 * 语音会话不下发的桌面区块，按块内标记匹配。
 *
 * 为什么是“过滤”而不是“在尾部作废”：`<citation_requirements>` 明确要求 `"Sources:"`
 * 段与 markdown 链接，而 `web_search` 的工具结果里又恰好带一份同样形状的来源列表
 * （`web-tools.ts` 的 `formatSearch`）—— 尾部一句“以上规则不适用”压不过这两处范例。
 * 真机证据：2026-10-07 语音会话 `a0cb700c` 里 3 条带 Sources 的回答全部出在带搜索的轮次。
 * 语音里也没有文件、没有产物、没有子代理，这些区块本来就没有出口。
 *
 * 按标记匹配而不是按索引：区块会增删，索引会漂。两个方向都由
 * `src/tests/voice/turn-profiles.test.ts` 拦住：标记失配（标记改了名）与未分类区块
 * （新增一块但两边名单都没它）都会让测试先红 —— 后者正是"悄悄漏进语音"的那条路。
 */
export const DESKTOP_ONLY_APPEND_MARKERS = [
  "citation_requirements",
  "tool_behavior",
  "file_references",
  "subagent_naming",
  "artifacts",
] as const;

/**
 * 语音会话**保留**的区块标记。只有分类测试用它，过滤本身用上面的桌面名单 ——
 * 两份名单合起来要求每个区块**恰好**属于一边，新增区块漏了分类就报错。
 * `workspace_info` 那一块是变量（不是字面量），不进分类测试。
 */
export const VOICE_KEPT_APPEND_MARKERS = [
  "DeskWand assistant",
  "CRITICAL RULES",
] as const;

/**
 * 按会话类型过滤 append 提示词区块。
 *
 * **文字会话必须逐字节原样返回** —— 这份文本在每个请求的头部，改一个字符就让提示词
 * 缓存整体失效（AGENTS.md §5）。语音会话是独立会话，本来每轮工具集就在变，不新增失效点。
 */
export function filterAppendPromptForSessionKind(
  blocks: readonly string[],
  kind: SessionKind | undefined,
): string[] {
  if (!isVoiceSession({ kind })) return [...blocks];
  return blocks.filter(
    (block) =>
      !DESKTOP_ONLY_APPEND_MARKERS.some((marker) => block.includes(marker)),
  );
}
