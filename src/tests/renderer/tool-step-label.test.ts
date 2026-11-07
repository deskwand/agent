// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import { getToolStepLabel } from "../../renderer/utils/tool-step-label";

const t = i18n.t.bind(i18n);

beforeAll(async () => {
  await i18n.changeLanguage("zh");
});

describe("getToolStepLabel", () => {
  it("有 description 时用它，并且不是等宽文本", () => {
    const label = getToolStepLabel(
      "bash",
      { command: "wrangler whoami", description: "查看 wrangler 登录状态" },
      t,
    );
    expect(label).toEqual({ text: "查看 wrangler 登录状态", mono: false });
  });

  it("description 前后空白会被裁掉", () => {
    const label = getToolStepLabel(
      "bash",
      { command: "ls", description: "  列一下目录  " },
      t,
    );
    expect(label.text).toBe("列一下目录");
    expect(label.mono).toBe(false);
  });

  it("description 超长时截断到 160 字符并加省略号", () => {
    const long = "查".repeat(200);
    const label = getToolStepLabel(
      "bash",
      { command: "ls", description: long },
      t,
    );
    expect(label.text.length).toBe(161);
    expect(label.text.endsWith("…")).toBe(true);
  });

  it("description 不是字符串时忽略，回落到命令", () => {
    const label = getToolStepLabel(
      "bash",
      { command: "ls", description: 42 },
      t,
    );
    expect(label.mono).toBe(true);
  });

  it("已知命令走本地动词表", () => {
    expect(getToolStepLabel("bash", { command: "git status -sb" }, t)).toEqual({
      text: i18n.t("tool.step.cmdGitStatus"),
      mono: false,
    });
    expect(
      getToolStepLabel("bash", { command: "npx vitest run foo.test.ts" }, t),
    ).toEqual({ text: i18n.t("tool.step.cmdRunTests"), mono: false });
  });

  it("未知命令回落到 `$ 命令` 等宽文本", () => {
    const label = getToolStepLabel("bash", { command: "./deploy.sh --now" }, t);
    expect(label.mono).toBe(true);
    expect(label.text).toContain("./deploy.sh --now");
  });

  it("其他工具的同名 description 不采信（MCP 参数语义各不同）", () => {
    const label = getToolStepLabel(
      "mcp__fs__read_file",
      { path: "/tmp/a.ts", description: "Read the project config" },
      t,
    );
    expect(label.mono).toBe(true);
    expect(label.text).not.toContain("Read the project config");
  });

  it("非 bash 工具沿用既有标签，等宽显示", () => {
    const label = getToolStepLabel("read", { file_path: "/tmp/a.ts" }, t);
    expect(label.mono).toBe(true);
    // getToolLabel 会做路径缩短（shortenPath），这里不钉死绝对路径
    expect(label.text).toContain("a.ts");
    expect(label.text).toContain("读取");
  });

  it("空输入不抛错", () => {
    expect(() => getToolStepLabel("bash", undefined, t)).not.toThrow();
    expect(() => getToolStepLabel("read", {}, t)).not.toThrow();
  });
});
