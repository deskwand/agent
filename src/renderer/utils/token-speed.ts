/**
 * 生成速度的显示格式。
 *
 * 10 以下保留一位小数（8.4），10 及以上取整（42）—— 低速时小数有意义，
 * 高速时小数只是抖动。单位不翻译，与 `execution-clock` 的 `12s` 取舍一致。
 */
export function formatTokenSpeed(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 10) / 10;
  if (rounded <= 0) return "";
  const text = rounded < 10 ? rounded.toFixed(1) : String(Math.round(rounded));
  return `${text} tok/s`;
}
