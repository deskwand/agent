/** 概览「更改」的数字：288px 宽下必须一眼可读，不允许撑破一行。 */
export function formatChangeCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
