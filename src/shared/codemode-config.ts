/**
 * codemode（模型写 JS 调用工具）的开关与旋钮。
 *
 * **默认关**，跟随参考实现：pi 的内置扩展 `builtin:codemode` 虽然默认加载，但**未激活**，
 * 要手动 `+codemode`（`docs/settings.md`）。DeskWand 照做 —— 装上但不主动激活：
 * 激活由 MCP 的 exposure 派生（见下），没有 MCP 服务时它就不激活。
 *
 * **只剩 `mode` 一个旋钮**，透传给 `createCodemodeExtension(options)`（它**覆盖**同名 SDK
 * 设置，所以不需要碰 `PiSettingsManager`）：
 *  - `mode`：`on` = 已声明的工具在自己描述里追加一份自己的 TS 签名，codemode 只列未声明的工具；
 *           `only` = 已声明工具从请求里整个撤掉，模型只能经 codemode 到达它们。
 *
 * **`inlineBudget` 已下线**：codemode 描述里内联的工具签名（非 `direct` 的那些，主要是 MCP）
 * 实测吃掉 14.5k 字符（3.6k token），而 268 个 MCP 工具当时也只列出了 13 个。产品固定传
 * `CODEMODE_INLINE_BUDGET = 0`（只列 namespace 与工具数），模型在脚本里用 `searchTools()` /
 * `describeTool()` / `ALL_TOOLS` 现场找。要改就改本文件的常量，不再回落到用户配置。
 *
 * 不传 `models` —— 跟随上游默认（`true`，脚本可访问模型目录/分类器）。
 * 若将来要关掉，那是**显式偏离**，必须在此处与 design doc 写明理由。
 */
export const CODEMODE_MODES = ["on", "only"] as const;
export type CodemodeMode = (typeof CODEMODE_MODES)[number];

/**
 * 只有 pi 真实存在的旋钮。
 *
 * **没有 `enabled`** —— pi 没有这个字段。codemode 的激活是**派生**的：有 `exposure: "codemode"`
 * 的 MCP server 连上时由上游激活（`ensureDiscoveryActive`），或用 `defaultTools: ["+codemode"]`。
 * 曾经加过一个全局 `enabled`，但它会被那条派生路径**静默盖过** ⇒ 是个会撒谎的开关，已删。
 * 全局 opt-out 请用 `mcp.json` 顶层的 `autoEnableCodemode: false`（pi 的官方做法）。
 */
export interface CodemodeConfig {
  mode: CodemodeMode;
}

/** MCP 工具声明内联预算：0 = codemode 描述里只列 namespace 与工具数。 */
export const CODEMODE_INLINE_BUDGET = 0;

export function normalizeCodemodeConfig(raw: unknown): CodemodeConfig {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = CODEMODE_MODES.find((candidate) => candidate === value.mode);
  return { mode: mode ?? "on" };
}
