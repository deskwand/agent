/**
 * 欢迎页快捷入口的数据表。
 *
 * 单独成文件的理由：它是测试的断言对象（「技能名是否真实存在」「i18n key 是否
 * 齐全」「禁用后是否隐藏」都不需要渲染 React），而 chip 行的展示内联在
 * WelcomeView 里 —— 那部分单次使用，不为它造抽象。
 *
 * 顺序承载可读性：界面不分组，所以相邻关系就是唯一的组织手段。两个工具入口按
 * 能力亲缘插在中间 ——「看图」紧跟「处理 PDF」（都是处理输入），「操作浏览器」
 * 紧跟「联网搜索」（都是面向网络）。
 *
 * labelKey 写成字面量而不是用 id 拼模板串：模板串 grep 不到，字面量能被搜索和
 * 逐条核对。
 */

export type WelcomeQuickEntry =
  | {
      id: string;
      kind: "skill";
      /** `/skill:<skill>` 里的技能名，必须与 .deskwand/skills/<skill>/ 目录同名 */
      skill: string;
      labelKey: string;
    }
  | {
      id: string;
      kind: "tool";
      labelKey: string;
      /** 示例任务提示词的 i18n key，点击后填进输入框 */
      promptKey: string;
      icon: "globe" | "eye";
      /** 该入口依赖视觉能力；能力不可用时整个入口不渲染 */
      needsVision?: boolean;
    };

export const WELCOME_QUICK_ENTRIES: readonly WelcomeQuickEntry[] = [
  {
    id: "brainstorm",
    kind: "skill",
    skill: "brainstorming",
    labelKey: "welcome.quick.brainstorm",
  },
  {
    id: "debug",
    kind: "skill",
    skill: "systematic-debugging",
    labelKey: "welcome.quick.debug",
  },
  {
    id: "review",
    kind: "skill",
    skill: "requesting-code-review",
    labelKey: "welcome.quick.review",
  },
  {
    id: "git",
    kind: "skill",
    skill: "git-workflow",
    labelKey: "welcome.quick.git",
  },
  {
    id: "office",
    kind: "skill",
    skill: "officecli",
    labelKey: "welcome.quick.office",
  },
  {
    id: "pdf",
    kind: "skill",
    skill: "pdf",
    labelKey: "welcome.quick.pdf",
  },
  {
    id: "vision",
    kind: "tool",
    labelKey: "welcome.quick.vision",
    promptKey: "welcome.quickPrompt.vision",
    icon: "eye",
    needsVision: true,
  },
  {
    id: "notes",
    kind: "skill",
    skill: "meeting-notes",
    labelKey: "welcome.quick.notes",
  },
  {
    id: "web",
    kind: "skill",
    skill: "web-search",
    labelKey: "welcome.quick.web",
  },
  {
    id: "browser",
    kind: "tool",
    labelKey: "welcome.quick.browser",
    promptKey: "welcome.quickPrompt.browser",
    icon: "globe",
  },
];

/**
 * 挑出当前该显示的入口。
 *
 * 抽成纯函数的唯一理由是它必须能被行为测试覆盖：内联在 JSX 的三元表达式里，
 * 就只能靠「源码里出现过这个字符串」去守，而那种断言发现不了条件写反 —— 这正是
 * 「被禁用的技能仍然显示」这类 bug 最容易溜过去的地方。
 *
 * @param enabledSkills 已启用技能的名字集合（来自 electronAPI.skills.getAll 的过滤结果）
 * @param visionAvailable 视觉能力是否可用（主进程只在配了视觉模型或登录云时才注册 vision_describe）
 */
export function visibleQuickEntries(
  entries: readonly WelcomeQuickEntry[],
  enabledSkills: ReadonlySet<string>,
  visionAvailable: boolean,
): WelcomeQuickEntry[] {
  return entries.filter((entry) =>
    entry.kind === "tool"
      ? !entry.needsVision || visionAvailable
      : enabledSkills.has(entry.skill),
  );
}
