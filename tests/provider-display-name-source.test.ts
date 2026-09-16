import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) =>
  fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

/**
 * 云 provider 的 name 是登录/启动时按当时语言写进配置的字符串，切语言不会重建。
 * 这三处展示 provider 名字的地方必须走 resolveProviderDisplayName() 实时取 i18n 文案，
 * 否则英文界面会一直显示存下来的中文（或反过来）。
 */
describe("Provider display name wiring", () => {
  for (const file of [
    "src/renderer/components/ChatView.tsx",
    "src/renderer/components/WelcomeView.tsx",
    "src/renderer/components/settings/SubagentSettings.tsx",
  ]) {
    it(`${file} resolves the provider label through the shared helper`, () => {
      const source = read(file);
      expect(source).toContain("resolveProviderDisplayName(");
    });
  }
});
