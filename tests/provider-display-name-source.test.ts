import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) =>
  fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

/**
 * 云 provider 的 name 是登录/启动时按当时语言写进配置的字符串，切语言不会重建。
 * 下面这些展示 provider 名字的地方必须走 resolveProviderDisplayName() 实时取 i18n 文案，
 * 否则英文界面会一直显示存下来的中文（或反过来）。
 */
describe("Provider display name wiring", () => {
  for (const file of [
    "src/renderer/components/ChatView.tsx",
    "src/renderer/components/WelcomeView.tsx",
    "src/renderer/components/settings/SubagentSettings.tsx",
    "src/renderer/components/settings/SettingsAPI.tsx",
  ]) {
    it(`${file} resolves the provider label through the shared helper`, () => {
      const source = read(file);
      expect(source).toContain("resolveProviderDisplayName(");
    });
  }

  it("keeps t in the model-options memo deps so labels follow language switches", () => {
    // 把 t 从依赖里删掉后 memo 不会在切语言时重算，云 provider 的标题又回到旧语言，
    // 而组件单测察觉不到（实测变异可全绿），因此用源码断言盯住这个依赖。
    for (const file of [
      "src/renderer/components/ChatView.tsx",
      "src/renderer/components/WelcomeView.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("[appConfig?.providers, t]");
    }
  });
});
