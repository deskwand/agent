import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("cloud thinking level is user-controlled", () => {
  for (const file of [
    "src/renderer/components/ChatView.tsx",
    "src/renderer/components/WelcomeView.tsx",
  ]) {
    it(`${file} no longer locks thinking to a preset mode`, () => {
      const source = read(file);
      expect(source).not.toContain("cloudConfig?.modes");
      expect(source).not.toContain("effectiveThinkingLevel");
    });
  }

  it("drops the modes i18n block from both locales", () => {
    for (const locale of ["zh", "en"]) {
      const json = read(`src/renderer/i18n/locales/${locale}.json`);
      expect(json).not.toContain('"modes"');
    }
  });
});
