/**
 * 内置技能的默认启用状态。
 *
 * 名单里的技能**默认禁用**：不交给 pi、不进系统提示，但仍在技能页里可见，
 * 用户点一下就能打开（打开会写一行 DB 记录，从此以那一行为准）。
 *
 * 名单只放「默认不送进模型、但要在技能页找得到」的技能：开发流程链、开发工具、
 * 小众创作、办公输出（图表 / 文档协作 / 内部沟通 / 会议纪要 —— 默认关是为了压
 * 系统提示开销，要用时去技能页点开）。superpowers pack 的 15 个技能里只有
 * writing-plans、requesting-code-review、executing-plans 与
 * subagent-driven-development 不在本名单；产品耦合（officecli 系列有
 * 大量代码引用）与欢迎页入口对应的技能（brainstorming / systematic-debugging /
 * officecli）一律保留默认启用。
 *
 * 取值口径：没有 DB 行 ⇒ 用这里；有 DB 行 ⇒ 用行里的值（行只由 `setSkillEnabled()`
 * 写入，见 `skills-manager.ts`）。
 */
export const DEFAULT_DISABLED_BUILTINS: ReadonlySet<string> = new Set([
  // 开发流程链
  "using-superpowers",
  "test-driven-development",
  "receiving-code-review",
  "verification-before-completion",
  "using-git-worktrees",
  "finishing-a-development-branch",
  "dispatching-parallel-agents",
  "writing-skills",
  "diagnosing-superpowers",
  "karpathy-guidelines",
  "ponytail",
  "git-workflow",
  // 开发工具
  "docker-helper",
  "sql-query",
  "regex-tester",
  "shell-script",
  "config-validator",
  "json-yaml-tools",
  "webapp-testing",
  "mcp-builder",
  "frontend-design",
  // 小众创作
  "algorithmic-art",
  "canvas-design",
  "web-artifacts-builder",
  "theme-factory",
  "brand-guidelines",
  "slack-gif-creator",
  // 办公输出（图表 / 文档协作 / 内部沟通 / 会议纪要）
  "data-chart",
  "doc-coauthoring",
  "internal-comms",
  "meeting-notes",
]);

/**
 * 单个内置技能的启用状态：DB 行优先，其次名单默认值。
 *
 * @param dirName 内置技能目录名（等于技能名，也是 `builtin-<dirName>` 这个 id 的后半段）
 * @param persisted `SELECT enabled FROM skills WHERE id = 'builtin-<dirName>'` 的结果；
 *                  没有这一行时传 `undefined`
 */
export function resolveBuiltinSkillEnabled(
  dirName: string,
  persisted: boolean | undefined,
): boolean {
  if (persisted !== undefined) return persisted;
  return !DEFAULT_DISABLED_BUILTINS.has(dirName);
}
