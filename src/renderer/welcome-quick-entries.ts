/**
 * 欢迎页快捷入口的数据表。
 *
 * 单独成文件的理由：它是测试的断言对象（「技能名是否真实存在」「i18n key 是否
 * 齐全」「禁用后是否隐藏」「图标是否互不相同」都不需要渲染 React），而 chip 行的
 * 展示内联在 WelcomeView 里 —— 那部分单次使用，不为它造抽象。
 *
 * 规模：5 个入口，每个代表一个能力簇 —— 通用任务 / 代码 / 文档产物 / 网络 /
 * 多模态。界面不给小标题，所以「一个簇一个入口」就是这 5 个位置的全部组织规则。
 * 想加第 6 个，先回答它代表哪个新簇；答不上来就是在往发现性里掺水 —— 欢迎页是
 * 能力边界的教学场，不是功能清单。落选的入口（审代码 / PR / PDF / 会议纪要 /
 * 操作浏览器）仍可从「+」菜单与斜杠菜单进入，不是没了。
 *
 * 图标名必须由这张表决定（见 WelcomeQuickEntryIcon），不许在 WelcomeView 里按 id
 * 另写一份映射 —— 两份表迟早漂移。
 *
 * labelKey 写成字面量而不是用 id 拼模板串：模板串 grep 不到，字面量能被搜索和
 * 逐条核对。
 */

export type WelcomeQuickEntryIcon =
  | "sparkles"
  | "bug"
  | "file-text"
  | "globe"
  | "eye";

export type WelcomeQuickEntry =
  | {
      id: string;
      kind: "skill";
      /** `/skill:<skill>` 里的技能名，必须与 .deskwand/skills/<skill>/ 目录同名 */
      skill: string;
      labelKey: string;
      icon: WelcomeQuickEntryIcon;
    }
  | {
      id: string;
      kind: "tool";
      labelKey: string;
      /** 示例任务提示词的 i18n key，点击后填进输入框 */
      promptKey: string;
      icon: WelcomeQuickEntryIcon;
      /** 该入口依赖视觉能力；能力不可用时整个入口不渲染 */
      needsVision?: boolean;
    };

export const WELCOME_QUICK_ENTRIES: readonly WelcomeQuickEntry[] = [
  // 位置 1 固定给覆盖面最广的入口：回来后总能在同一个地方找到它。
  {
    id: "brainstorm",
    kind: "skill",
    skill: "brainstorming",
    labelKey: "welcome.quick.brainstorm",
    icon: "sparkles",
  },
  // 代码
  {
    id: "debug",
    kind: "skill",
    skill: "systematic-debugging",
    labelKey: "welcome.quick.debug",
    icon: "bug",
  },
  // 文档产物
  {
    id: "office",
    kind: "skill",
    skill: "officecli",
    labelKey: "welcome.quick.office",
    icon: "file-text",
  },
  // 网络。以前是 `/skill:web-search` 令牌，但技能内容与 web_search / fetch_content /
  // get_search_content 三个工具高度重叠，技能已退役；入口改成示例提示词（与「看图」同型），
  // 点一下得到一句话，用户补上主题即可发送。
  {
    id: "web",
    kind: "tool",
    labelKey: "welcome.quick.web",
    promptKey: "welcome.quickPrompt.web",
    icon: "globe",
  },
  // 多模态。放末位是因为它是唯一有前置条件的入口：其余几个点完就能发送，
  // 这个点完得到一段长提示词、还得自己把图拖进来。
  {
    id: "vision",
    kind: "tool",
    labelKey: "welcome.quick.vision",
    promptKey: "welcome.quickPrompt.vision",
    icon: "eye",
    needsVision: true,
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
