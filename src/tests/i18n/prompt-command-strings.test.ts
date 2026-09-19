import { describe, expect, it } from "vitest";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";

/**
 * 引用技能那句话是**给模型的动作指令**，`{{name}}` 是它唯一的变量。
 * 丢了这个占位符，插进正文的就是一句没有技能名的空话 —— 而那种错
 * 用眼睛扫 locale 文件很难发现，所以在这里钉一下。
 */
describe("chat.commandSkillReference", () => {
  it("两种语言都带 {{name}} 占位符，且中文就是那句（书名号包住技能名）", () => {
    expect(zh.chat.commandSkillReference).toBe("请引用「{{name}}」技能。");
    expect(en.chat.commandSkillReference).toContain("{{name}}");
  });
});
