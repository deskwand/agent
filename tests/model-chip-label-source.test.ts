import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const chipPath = path.resolve(
  process.cwd(),
  "src/renderer/components/MergedInputChip.tsx",
);

describe("Model chip label wiring", () => {
  it("uses resolveModelLabel for the current model display name", () => {
    const source = fs.readFileSync(chipPath, "utf8");
    expect(source).toContain("resolveModelLabel(");
    expect(source).toContain("currentModelLabel");
  });

  it("renders currentModelLabel in both chip and menu row", () => {
    const source = fs.readFileSync(chipPath, "utf8");
    const occurrences =
      source.split('{currentModelLabel || t("chat.noModel")}').length - 1;
    expect(occurrences).toBe(2);
  });
});
