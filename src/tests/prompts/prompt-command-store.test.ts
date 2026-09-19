import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  deletePromptCommand,
  getPromptsDir,
  promptCommandFilePath,
  readPromptCommand,
  savePromptCommand,
  serializePromptCommandFile,
} from "../../main/prompts/prompt-command-store";

// 这些值每一种都能把「拼字符串写 frontmatter」打坏：
// `:` 与 `#` 会被 YAML 当语法、`"` 与 `\` 会破坏引号 / 转义，
// 而 pi 解析失败时 loadTemplateFromFile 直接 return null —— 命令从菜单里静默消失。
const NASTY = [
  "翻译成英文",
  "含冒号: 的值",
  "含井号 # 的值",
  '含双引号 " 的值',
  "含反斜杠 C:\\path 的值",
  "emoji 🎯 与单引号 ' 混排",
];

describe("serializePromptCommandFile", () => {
  it("写出的 frontmatter 能被 pi 的 parseFrontmatter 读回来", () => {
    for (const value of NASTY) {
      const file = serializePromptCommandFile(
        { displayName: value, content: "正文" },
        null,
      );
      const { frontmatter, body } = parseFrontmatter(file);
      expect(frontmatter.display_name).toBe(value);
      expect(body).toBe("正文");
    }
  });

  // 我们只管 display_name 一个字段：description / argument-hint / 任何第三方字段
  // 必须逐字保留 —— 用户手写的（或在终端 pi 里设的）不能被我们吞掉。
  it("只重写 display_name，其余 frontmatter 字段原样保留", () => {
    const previous =
      '---\nargument-hint: "<PR-URL>"\ndescription: "旧描述"\ndisplay_name: "旧名"\n---\n\n旧正文\n';
    const file = serializePromptCommandFile(
      { displayName: "代码审查", content: "新正文" },
      previous,
    );
    const { frontmatter } = parseFrontmatter(file);
    expect(frontmatter["argument-hint"]).toBe("<PR-URL>");
    expect(frontmatter.description).toBe("旧描述");
    expect(frontmatter.display_name).toBe("代码审查");
  });

  it("显示名清空时只删那一行，description 不动", () => {
    const previous =
      '---\ndescription: "旧描述"\ndisplay_name: "旧名"\n---\n\n旧正文\n';
    const file = serializePromptCommandFile(
      { displayName: "  ", content: "正文" },
      previous,
    );
    const { frontmatter } = parseFrontmatter(file);
    expect(frontmatter.display_name).toBeUndefined();
    expect(frontmatter.description).toBe("旧描述");
  });

  it("没有任何 frontmatter 字段时不写 --- 块", () => {
    expect(serializePromptCommandFile({ content: "只有正文" }, null)).toBe(
      "只有正文\n",
    );
  });
});

describe("savePromptCommand / readPromptCommand / deletePromptCommand", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "prompt-cmd-"));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("目录不存在时自动创建并写入", () => {
    const result = savePromptCommand(
      agentDir,
      { name: "translate", displayName: "翻译成英文", content: "正文" },
      { isCreate: true },
    );
    expect(result).toEqual({ ok: true });
    const saved = readPromptCommand(promptCommandFilePath(agentDir, "translate"));
    expect(saved).toEqual({
      name: "translate",
      displayName: "翻译成英文",
      content: "正文",
    });
    expect(getPromptsDir(agentDir).endsWith("prompts")).toBe(true);
  });

  it("新建时同名文件已存在则拒绝，且不改动原文件", () => {
    savePromptCommand(agentDir, { name: "translate", content: "第一次" }, { isCreate: true });
    const again = savePromptCommand(
      agentDir,
      { name: "translate", content: "第二次" },
      { isCreate: true },
    );
    expect(again).toEqual({ ok: false, error: "exists" });
    expect(readPromptCommand(promptCommandFilePath(agentDir, "translate"))?.content).toBe(
      "第一次",
    );
  });

  it("编辑模式覆盖并保留未知字段", () => {
    const file = promptCommandFilePath(agentDir, "review");
    mkdirSync(getPromptsDir(agentDir), { recursive: true });
    writeFileSync(file, '---\nargument-hint: "<PR>"\n---\n\n旧正文\n', "utf-8");
    expect(
      savePromptCommand(agentDir, { name: "review", content: "新正文" }, { isCreate: false }),
    ).toEqual({ ok: true });
    const raw = readFileSync(file, "utf-8");
    expect(parseFrontmatter(raw).frontmatter["argument-hint"]).toBe("<PR>");
    expect(readPromptCommand(file)?.content).toBe("新正文");
  });

  it("名字非法时拒绝且不落盘", () => {
    expect(
      savePromptCommand(agentDir, { name: "compact", content: "x" }, { isCreate: true }),
    ).toEqual({ ok: false, error: "reserved" });
    expect(
      savePromptCommand(agentDir, { name: "a/b", content: "x" }, { isCreate: true }),
    ).toEqual({ ok: false, error: "invalidChars" });
    expect(readPromptCommand(promptCommandFilePath(agentDir, "a/b"))).toBeNull();
  });

  it("读不存在的文件返回 null", () => {
    expect(readPromptCommand(promptCommandFilePath(agentDir, "nope"))).toBeNull();
  });

  it("删除已存在返回 true，再删返回 false", () => {
    savePromptCommand(agentDir, { name: "tmp", content: "x" }, { isCreate: true });
    expect(deletePromptCommand(agentDir, "tmp")).toBe(true);
    expect(deletePromptCommand(agentDir, "tmp")).toBe(false);
  });
});

describe("serializePromptCommandFile · frontmatter 逐字保留", () => {
  it("多行标量里的空行不被吞掉", () => {
    const previous =
      '---\ndescription: |\n  第一段\n\n  第二段\n---\n\n旧正文\n';
    const file = serializePromptCommandFile(
      { displayName: "名称", content: "正文" },
      previous,
    );
    const { frontmatter } = parseFrontmatter(file);
    // 空行是内容：description 必须是两段，而不是被合并/截断
    expect(frontmatter.description).toBe("第一段\n\n第二段\n");
  });

  it("缩进的同名键（嵌套映射的续行）不被当成我们的字段删掉", () => {
    const previous = '---\nfoo:\n  display_name: "别人的"\n---\n\n旧正文\n';
    const file = serializePromptCommandFile(
      { displayName: "我们的", content: "正文" },
      previous,
    );
    expect(file).toContain('  display_name: "别人的"');
    expect(parseFrontmatter(file).frontmatter.display_name).toBe("我们的");
  });

  it("带 BOM 的文件也能保留原有字段", () => {
    const previous = '\uFEFF---\nargument-hint: "<PR>"\n---\n\n旧正文\n';
    const file = serializePromptCommandFile(
      { displayName: "名称", content: "正文" },
      previous,
    );
    expect(parseFrontmatter(file).frontmatter["argument-hint"]).toBe("<PR>");
    expect(parseFrontmatter(file).frontmatter.display_name).toBe("名称");
  });
});
