// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import {
  getCodemodeScriptLabel,
  readScriptIntent,
} from "../../renderer/utils/codemode-script-label";

const t = i18n.t.bind(i18n);

beforeAll(async () => {
  await i18n.changeLanguage("zh");
});

describe("readScriptIntent", () => {
  it("读首行注释", () => {
    expect(readScriptIntent("// 查三个站点的优惠码\nconst a = 1")).toBe(
      "查三个站点的优惠码",
    );
  });

  it("跳过 // @options 指令行", () => {
    const code =
      '// @options: {"timeout_ms": 60000}\n// 搜索优惠码\nconst a = 1';
    expect(readScriptIntent(code)).toBe("搜索优惠码");
  });

  it("跳过前导空行", () => {
    expect(readScriptIntent("\n\n// 合并结果\nconst a = 1")).toBe("合并结果");
  });

  it("首行是代码时不往深处找注释", () => {
    expect(readScriptIntent("const a = 1 // 行内注释")).toBeNull();
    expect(readScriptIntent("const a = 1\n// 后面的注释")).toBeNull();
  });

  it("多行注释只取第一行，并裁掉首尾空白", () => {
    expect(readScriptIntent("//   第一行   \n// 第二行\nconst a = 1")).toBe(
      "第一行",
    );
  });

  it("超长截断到 160 字符", () => {
    const long = "意".repeat(200);
    const intent = readScriptIntent(`// ${long}\nconst a = 1`);
    expect(intent?.length).toBe(161);
    expect(intent?.endsWith("…")).toBe(true);
  });

  it("只有注释头时返回 null", () => {
    expect(readScriptIntent("//\nconst a = 1")).toBeNull();
    expect(readScriptIntent("")).toBeNull();
    expect(readScriptIntent(null)).toBeNull();
    expect(readScriptIntent(42)).toBeNull();
  });
});

describe("getCodemodeScriptLabel", () => {
  it("有意图注释时用它", () => {
    expect(getCodemodeScriptLabel("// 搜索优惠码\nconst a = 1", 3, t)).toBe(
      "搜索优惠码",
    );
  });

  it("没有意图时用步数区分", () => {
    expect(getCodemodeScriptLabel("const a = 1", 3, t)).toBe(
      i18n.t("tool.step.scriptSteps", { count: 3 }),
    );
  });

  it("没有意图也没有子调用时退回脚本详情", () => {
    expect(getCodemodeScriptLabel("const a = 1", 0, t)).toBe(
      i18n.t("tool.grouped.scriptDetails"),
    );
  });
});
