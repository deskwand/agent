/**
 * @module renderer/utils/codemode-script-label
 *
 * codemode 脚本行的标题。一个工具组里常常有好几次脚本调用，全都写「脚本详情」
 * 就分不清谁是谁（出现过三行一模一样的字）。
 *
 * 标题按三级回落：脚本首行的意图注释 → `脚本 · N 步` → 「脚本详情」。
 * 意图注释来自提示词约定（见 agent-runner 的 `codemodeIntentPrefix`），不占用工具参数。
 */
import type { TFunction } from "i18next";

/** 与 bash 的行标题同一个上限，避免一行字撑爆行头。 */
const MAX_LABEL_CHARS = 160;
/** codemode 的脚本级指令：`// @options: {...}`，不是意图。 */
const OPTIONS_PRAGMA = /^\/\/\s*@/;
const LINE_COMMENT = /^\/\/\s?/;

/**
 * 只认脚本**开头**那一段注释：跳过空行与 `@options` 指令，读到第一条 `//` 就返回。
 * 一旦碰到代码就停 —— 否则会把脚本深处的行内注释当成标题。
 */
export function readScriptIntent(code: unknown): string | null {
  if (typeof code !== "string" || !code) return null;
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (OPTIONS_PRAGMA.test(line)) continue;
    if (!line.startsWith("//")) return null;
    const text = line.replace(LINE_COMMENT, "").trim();
    if (!text) continue;
    return text.length > MAX_LABEL_CHARS
      ? `${text.slice(0, MAX_LABEL_CHARS)}…`
      : text;
  }
  return null;
}

export function getCodemodeScriptLabel(
  code: unknown,
  stepCount: number,
  t: TFunction,
): string {
  const intent = readScriptIntent(code);
  if (intent) return intent;
  if (stepCount > 0) return t("tool.step.scriptSteps", { count: stepCount });
  return t("tool.grouped.scriptDetails");
}
