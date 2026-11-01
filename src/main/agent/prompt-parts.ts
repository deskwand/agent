/**
 * 系统侧三块的量级：系统提示词本体 / 工具定义 / 技能清单。
 *
 * 为什么要在主进程量：这三样文本只有 SDK 手里有。渲染层的「上下文分类」只有一条
 * 精确数字（`totalPromptInput`）和一份按块估算的消息历史，系统侧永远是
 * 「总量 − 消息侧」的残差 —— 想知道残差里谁占大头，只能回到 SDK 那儿取原文。
 *
 * 三种量都在这里量，**只量不改**：读 `session.systemPrompt` 与工具注册表都不碰
 * 提示词文本，所以不影响提示词缓存（AGENTS.md §5）。
 */

import type { PromptParts } from "../../shared/prompt-parts";
import { estimateTextTokens } from "../../shared/token-estimate";

export type { PromptParts };

export interface PromptToolDeclaration {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface PromptPartInput {
  /** 系统提示词（`session.systemPrompt`）。 */
  systemPrompt: string;
  tools: ReadonlyArray<PromptToolDeclaration>;
  /**
   * 追加在本轮系统提示词末尾的段（语音档案的 `<voice_mode>`）。
   * 不在 `systemPrompt` 里：SDK 只在 run 期间带着 forced prompt，两次 run 之间回到 base。
   */
  promptSuffix?: string;
}

/**
 * SDK 把技能清单渲染成一个 `<skills>` 段（`formatSkillsForPrompt`），整段独立可切。
 *
 * **两端都锚在行首 / 行尾**：`project_context`（AGENTS.md）排在 `skills` 前面，一份
 * 正文里出现字面 `<skills>` 的文件会让不锚定的非贪婪匹配从那里切开，把真提示词
 * 当成技能。真段形如 `<skills>\n…<available_skills>…\n</skills>`，独占整行。
 */
const SKILLS_SECTION = /^<skills>\n[\s\S]*\n<\/skills>$/m;

function describeTool(tool: PromptToolDeclaration): string {
  let schema = "";
  if (tool.parameters !== undefined) {
    try {
      schema = JSON.stringify(tool.parameters) ?? "";
    } catch {
      // 参数 schema 理论上可序列化；真序列化不了就只算名字与描述，不抛给调用方。
      schema = "";
    }
  }
  return `${tool.name}\n${tool.description ?? ""}\n${schema}`;
}

/**
 * 量一次三块的 token 估算。
 *
 * 技能段从系统提示词里摘掉再量 —— 两块不重叠，否则技能会被算两遍。
 * 返回的三个数是**权重**（渲染层按比例分残差），不是总量：真实用量只有
 * provider 报的那一个数。
 */
export function measurePromptParts(input: PromptPartInput): PromptParts {
  const base = input.systemPrompt ?? "";
  const suffix = input.promptSuffix?.trim();
  const prompt = suffix ? `${base}\n\n${suffix}` : base;
  const skillsBlock = prompt.match(SKILLS_SECTION)?.[0] ?? "";
  const promptOnly = skillsBlock ? prompt.replace(skillsBlock, "") : prompt;

  return {
    // 注意：SDK 的 `<tools>` 段（每个工具一行 `- name: snippet`）也在这里，
    // 和下面的工具声明有少量重叠。它本来就是提示词正文，标签「系统提示词」不含
    // 「工具说明」的承诺，不值得为一个几百 token 的重叠把两处再切一遍。
    promptTokens: estimateTextTokens(promptOnly),
    toolTokens: input.tools.reduce(
      (total, tool) => total + estimateTextTokens(describeTool(tool)),
      0,
    ),
    skillTokens: estimateTextTokens(skillsBlock),
  };
}

/** 从 SDK 会话上取当前生效的工具声明。只认真的声明给模型的那批。 */
export interface PromptPartsSession {
  readonly systemPrompt: string;
  getActiveToolNames(): string[];
  getAllTools(): ReadonlyArray<PromptToolDeclaration>;
}

export function measureSessionPromptParts(
  session: PromptPartsSession,
  promptSuffix?: string,
): PromptParts {
  const active = new Set(session.getActiveToolNames());
  return measurePromptParts({
    systemPrompt: session.systemPrompt,
    tools: session.getAllTools().filter((tool) => active.has(tool.name)),
    promptSuffix,
  });
}
