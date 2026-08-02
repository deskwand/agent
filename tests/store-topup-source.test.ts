import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const storePath = path.resolve(process.cwd(), "src/renderer/store/index.ts");

describe("Store topup dialog state", () => {
  it("declares topUpOpen state and setter in the interface", () => {
    const source = fs.readFileSync(storePath, "utf8");
    expect(source).toContain("topUpOpen: boolean;");
    expect(source).toContain("setTopUpOpen: (open: boolean) => void;");
  });

  it("initializes topUpOpen to false and implements the setter", () => {
    const source = fs.readFileSync(storePath, "utf8");
    expect(source).toContain("topUpOpen: false,");
    expect(source).toContain(
      "setTopUpOpen: (open: boolean) => set({ topUpOpen: open }),",
    );
  });
});
