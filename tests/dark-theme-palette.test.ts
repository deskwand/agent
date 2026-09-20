import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const stylesPath = path.resolve(
  process.cwd(),
  "src/renderer/styles/globals.css",
);

describe("dark theme palette", () => {
  it("uses a graphite zinc palette for the default theme", () => {
    const source = fs.readFileSync(stylesPath, "utf8");
    expect(source).toContain("--color-background: #18181b;");
    expect(source).toContain("--color-surface: #27272a;");
    expect(source).toContain("--color-text-primary: #f4f4f5;");
  });

  it("gives the default theme a cool-blue accent instead of a neutral gray", () => {
    const source = fs.readFileSync(stylesPath, "utf8");
    // 改造前 accent 是 #d4d4d8（暗）/ #18181b（亮）——中性灰，与正文同质，
    // 彩度差只有 1.6 / 1.5，交互态根本看不出来。换成冷蓝后是 64.5 / 79.3。
    expect(source).toContain("--color-accent: #5b8cff;");
    expect(source).toContain("--color-accent-hover: #7ba3ff;");
    expect(source).toContain("--color-accent: #2563eb;");
  });
});
