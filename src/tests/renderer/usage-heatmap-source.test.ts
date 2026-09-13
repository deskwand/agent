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
