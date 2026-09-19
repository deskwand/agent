import { describe, expect, it } from "vitest";
import {
  PROMPT_COMMAND_NAME_MAX_LENGTH,
  validatePromptCommandName,
} from "../../shared/prompt-command-name";

describe("validatePromptCommandName", () => {
  it("接受普通标识符", () => {
    expect(validatePromptCommandName("translate")).toBeNull();
    expect(validatePromptCommandName("review-staged")).toBeNull();
    expect(validatePromptCommandName("a_b.c1")).toBeNull();
  });

  it("空名不合法", () => {
    expect(validatePromptCommandName("")).toBe("empty");
  });

  it("超长不合法", () => {
    expect(
      validatePromptCommandName("x".repeat(PROMPT_COMMAND_NAME_MAX_LENGTH + 1)),
    ).toBe("tooLong");
    expect(
      validatePromptCommandName("x".repeat(PROMPT_COMMAND_NAME_MAX_LENGTH)),
    ).toBeNull();
  });

  // 含空格的命令名 pi 永远匹配不上（/^\/([^\s]+)/ 按空白切第一段）
  it("含空白或路径分隔符不合法", () => {
    expect(validatePromptCommandName("my cmd")).toBe("invalidChars");
    expect(validatePromptCommandName("my\tcmd")).toBe("invalidChars");
    expect(validatePromptCommandName("a/b")).toBe("invalidChars");
    expect(validatePromptCommandName("a\\b")).toBe("invalidChars");
  });

  it("Windows 保留字符不合法", () => {
    for (const ch of [":", "*", "?", '"', "<", ">", "|"]) {
      expect(validatePromptCommandName(`a${ch}b`)).toBe("invalidChars");
    }
  });

  it("点开头或含 .. 不合法", () => {
    expect(validatePromptCommandName(".hidden")).toBe("leadingDot");
    expect(validatePromptCommandName("a..b")).toBe("invalidChars");
  });

  it("内置命令名保留", () => {
    expect(validatePromptCommandName("compact")).toBe("reserved");
    expect(validatePromptCommandName("goal")).toBe("reserved");
  });

  it("中文名合法（能用，但斜杠菜单只能按子串搜到）", () => {
    expect(validatePromptCommandName("翻译")).toBeNull();
  });
});
