import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function readFile(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("message card file attachment layout", () => {
  it("prevents file attachment row overflow with long filenames", () => {
    const source = readFile(
      "../src/renderer/components/message/ContentBlockView.tsx",
    );
    expect(source).toContain("max-w-full min-w-0");
    expect(source).toContain("overflow-hidden");
    expect(source).toContain("text-xs text-text-primary truncate");
  });
});
