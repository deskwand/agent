/**
 * codemode（模型写 JS 调用工具）的开关与旋钮。
 *
 * **默认关**，跟随参考实现：pi 的内置扩展 `builtin:codemode` 虽然默认加载，但**未激活**，
 * 要手动 `+codemode`（`docs/settings.md`）。DeskBend 照做 —— 装上、由这里决定开不开。
 *
 * 两个旋钮直接透传给 `createCodemodeExtension(options)`（它**覆盖**同名 SDK 设置，
 * 所以不需要碰 `PiSettingsManager`）：
 *  - `mode`：`on` = 已声明的工具在自己描述里追加一份自己的 TS 签名，codemode 只列未声明的工具；
 *           `only` = 已声明工具从请求里整个撤掉，模型只能经 codemode 到达它们。
 *  - `inlineBudget`：codemode 描述里最多花多少估算 token（字符/4）列工具声明；
 *           放不下的仍可调，用 `searchTools()` 现场找。**仅 `only` 模式实际生效** ——
 *           `on` 模式下 `listed` 只含非 `direct` 工具，而 DeskBand 的工具全是 `direct`。
 *
 * 不传 `models` —— 跟随上游默认（`true`，脚本可访问模型目录/分类器）。
 * 若将来要关掉，那是**显式偏离**，必须在此处与 design doc 写明理由。
 */
export const CODEMODE_MODES = ["on", "only"] as const;
export type CodemodeMode = (typeof CODEMODE_MODES)[number];

export interface CodemodeConfig {
  enabled: boolean;
  mode: CodemodeMode;
  inlineBudget: number;
}

export const DEFAULT_CODEMODE_INLINE_BUDGET = 3000;
export const MIN_CODEMODE_INLINE_BUDGET = 0;
export const MAX_CODEMODE_INLINE_BUDGET = 100_000;

export function normalizeCodemodeConfig(raw: unknown): CodemodeConfig {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = CODEMODE_MODES.find((candidate) => candidate === value.mode);
  const budget = Number(value.inlineBudget);
  return {
    enabled: value.enabled === true,
    mode: mode ?? "on",
    inlineBudget: Number.isFinite(budget)
      ? Math.min(
          MAX_CODEMODE_INLINE_BUDGET,
          Math.max(MIN_CODEMODE_INLINE_BUDGET, Math.floor(budget)),
        )
      : DEFAULT_CODEMODE_INLINE_BUDGET,
  };
}
