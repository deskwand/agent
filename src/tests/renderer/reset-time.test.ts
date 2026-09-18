import { describe, expect, it } from "vitest";
import { formatResetTime } from "../../renderer/utils/i18n-format";

/** 2026-09-18 22:19 本地时间。 */
const NOW = new Date(2026, 8, 18, 22, 19).getTime();

describe("formatResetTime", () => {
  it("同一天只给时分，不出现年份", () => {
    const sameDay = new Date(2026, 8, 18, 3, 19).getTime();

    const label = formatResetTime(sameDay, NOW);

    expect(label).not.toMatch(/\d{4}/);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });

  it("跨天给完整日期时间，包含年份", () => {
    const nextDay = new Date(2026, 8, 20, 19, 19).getTime();

    expect(formatResetTime(nextDay, NOW)).toMatch(/\d{4}/);
  });

  it("跨年也算跨天", () => {
    const nextYear = new Date(2027, 0, 1, 0, 5).getTime();

    expect(formatResetTime(nextYear, NOW)).toMatch(/\d{4}/);
  });
});
