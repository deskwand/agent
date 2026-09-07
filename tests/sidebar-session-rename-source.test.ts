import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Sidebar session rename contract", () => {
  it("contains the rename action and keyboard interaction", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/renderer/components/Sidebar.tsx"),
      "utf8",
    );
    expect(source).toContain('t("sidebar.rename")');
    expect(source).toContain("onKeyDown");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key === "Enter"');
    expect(source).toContain("renameSession");
  });
});
