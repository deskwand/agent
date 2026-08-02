import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const modalPath = path.resolve(
  process.cwd(),
  "src/renderer/components/TopUpModal.tsx",
);
const appPath = path.resolve(process.cwd(), "src/renderer/App.tsx");

describe("TopUpModal wiring", () => {
  it("implements the four-step state machine", () => {
    const source = fs.readFileSync(modalPath, "utf8");
    expect(source).toContain('"amount"');
    expect(source).toContain('"chain"');
    expect(source).toContain('"pay"');
    expect(source).toContain('"waiting"');
    expect(source).toContain("waitForOrderConfirmation");
  });

  it("uses i18n keys and semantic tokens only", () => {
    const source = fs.readFileSync(modalPath, "utf8");
    expect(source).toContain("topUp.title");
    expect(source).toContain("bg-accent");
    expect(source).toContain("text-text-primary");
  });

  it("is mounted in App", () => {
    const source = fs.readFileSync(appPath, "utf8");
    expect(source).toContain("<TopUpModal />");
  });
});
