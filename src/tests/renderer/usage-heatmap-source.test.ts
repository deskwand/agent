import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const dir = path.join(__dirname, "../../renderer/components/usage");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf-8");
const styles = fs.readFileSync(
  path.join(__dirname, "../../renderer/styles/globals.css"),
  "utf-8",
);

describe("heatmap components", () => {
  it("calendar heatmap has a usage/hit-rate colour toggle", () => {
    const text = read("UsageCalendarHeatmap.tsx");
    expect(text).toContain('"usage"');
    expect(text).toContain('"hit"');
    // Both colour modes go through the tested pure level resolver.
    expect(text).toContain("resolveCellLevel");
  });

  it("offers a cost colour mode alongside usage and hit rate", () => {
    const text = read("UsageCalendarHeatmap.tsx");
    // 第三个档位：模式名走 t(`usage.colorMode.${value}`)，所以断言数组而不是拼好的键
    expect(text).toContain('"usage", "hit", "cost"');
    expect(text).toContain("formatCost");
    // 两语言都必须有这一档的文案，否则按钮会渲染出原始 key
    for (const locale of ["zh", "en"]) {
      const json = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, `../../renderer/i18n/locales/${locale}.json`),
          "utf-8",
        ),
      ) as { usage: { colorMode: Record<string, string> } };
      expect(json.usage.colorMode.cost).toBeTruthy();
    }
  });

  it("uses semantic colour tokens, never raw hex", () => {
    for (const f of ["UsageCalendarHeatmap.tsx", "UsageHourHeatmap.tsx"]) {
      const text = read(f);
      expect(text).not.toMatch(/#[0-9a-fA-F]{6}/);
      expect(text).toContain("--color-success");
    }
  });

  it("renders an empty day differently from a low-usage day", () => {
    expect(read("UsageCalendarHeatmap.tsx")).toContain("usage-heatmap-empty");
    expect(read("UsageHourHeatmap.tsx")).toContain("usage-heatmap-empty");
    expect(styles).toContain(".usage-heatmap-empty");
  });

  it("labels the weekday column starting from Sunday", () => {
    const text = read("UsageCalendarHeatmap.tsx");
    expect(text).toContain('""');
    const labels = text.slice(
      text.indexOf("usage.weekday.mon") - 40,
      text.indexOf("usage.weekday.mon") + 200,
    );
    // Sunday's row (index 0) must be blank; Monday sits on row 2.
    expect(labels).toMatch(/"",\s*\n\s*t\("usage\.weekday\.mon"\)/);
  });

  it("lets the grid stretch instead of hard-coding a cell size", () => {
    const text = read("UsageCalendarHeatmap.tsx");
    // 7 个 CELL_PX 使用点必须全部消失（含 Cell 内的未来日占位格与真实格子）
    expect(text).not.toContain("CELL_PX");
    // 列宽由容器分配，最小 9px（不足则外层横向滚动）
    expect(text).toMatch(/gridAutoColumns:\s*["']minmax\(9px, 1fr\)["']/);
    // 正方形由列宽决定；alignSelf 必须为 start，否则行高被拉伸成矩形。
    // 断言"出现两次"（真实格子 + Cell 里的未来日占位格）——只查存在的话，
    // 漏改其中一处（正是占位格那处）也能通过。
    expect(text.match(/aspectRatio: "1"/g) ?? []).toHaveLength(2);
    expect(text.match(/alignSelf: "start"/g) ?? []).toHaveLength(2);
    // 周几标签槽固定宽度，与时段图的标签槽对齐
    expect(text).toContain("GUTTER_PX = 26");
    // 承载这一步的关键一行：列容器必须占据剩余宽度。它原本是 content-sized，
    // 宽度会被月份文字撑出 —— 那会让 1fr 无处可拉、格子尺寸反而由标签文字决定。
    // （实测：不加这两条时，1500px 卡片下网格只有 1121px，右侧仍留 319px。）
    expect(text).toContain("flex-1");
    expect(text).toContain("min-w-0");
  });

  it("keeps the worst hit-rate band visible instead of rendering it empty", () => {
    const text = read("UsageCalendarHeatmap.tsx");
    // Level 0 is the only "no record" level, and the hit scale starts at 1.
    expect(text).toContain(
      'const HIT_ALPHA = ["0", "1", "0.5", "0.42", "0.72", "1"]',
    );
    expect(text).toMatch(/\[1, 2, 3, 4, 5\]\.map/);
  });

  it("imports shared usage types from the shared contract", () => {
    expect(read("UsageCalendarHeatmap.tsx")).toContain(
      'from "../../../shared/usage"',
    );
    expect(read("UsageHourHeatmap.tsx")).toContain(
      'from "../../../shared/usage"',
    );
  });
});
