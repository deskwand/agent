import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "extract-ppocr-dict.mjs");
const FIXTURE = join(
  process.cwd(),
  "src",
  "tests",
  "ocr",
  "fixtures",
  "rec-inference-head.yml",
);

/** 真字典是五位数，守卫按 1000 项起步；测试要跨过它，就自己造够。 */
function bigYml(indent: string): string {
  const head = [
    "PostProcess:",
    "  name: CTCLabelDecode",
    "  character_dict:",
    `${indent}- '!'`,
    `${indent}- '"'`,
    `${indent}- $`,
    `${indent}- ''''`,
    `${indent}- 中`,
  ];
  const filler = Array.from({ length: 1200 }, (_, i) => `${indent}- x${i}`);
  return [...head, ...filler, "  use_space_char: true", ""].join("\n");
}

function run(ymlPath: string, outPath: string) {
  return execFileSync(process.execPath, [SCRIPT, ymlPath, outPath], {
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

describe("extract-ppocr-dict", () => {
  it("抽出字典、还原 YAML 引号转义、以换行结尾（prettier 的 4 空格缩进）", () => {
    const yml = join(tmpdir(), `rec-${process.pid}.yml`);
    const out = join(tmpdir(), `dict-${process.pid}.txt`);
    writeFileSync(yml, bigYml("    "));

    run(yml, out);

    const text = readFileSync(out, "utf8");
    // 字典文件必须以换行结尾（ppu-paddle-ocr README 明确要求）
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n").slice(0, -1);
    // '' 是 YAML 里一个单引号字符的写法；$ 是裸标量，两种都要还原对
    expect(lines.slice(0, 5)).toEqual(["!", '"', "$", "'", "中"]);
    expect(lines.length).toBe(1205);
  });

  it("上游那份 2 空格缩进的 yml 也能解析", () => {
    const yml = join(tmpdir(), `rec-upstream-${process.pid}.yml`);
    const out = join(tmpdir(), `dict-upstream-${process.pid}.txt`);
    writeFileSync(yml, bigYml("  "));

    run(yml, out);

    expect(readFileSync(out, "utf8").split("\n").slice(0, 3)).toEqual([
      "!",
      '"',
      "$",
    ]);
  });

  it("没有 character_dict 时报错，不产出文件", () => {
    const yml = join(tmpdir(), `rec-nokey-${process.pid}.yml`);
    writeFileSync(yml, "Global:\n  model_name: x\n");
    const out = join(tmpdir(), `dict-nokey-${process.pid}.txt`);
    let stderr = "";
    try {
      run(yml, out);
      throw new Error("应该失败但没有");
    } catch (error) {
      stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    }
    expect(stderr).toContain("character_dict");
  });

  it("条数远低于下限时报错并说清原因", () => {
    const out = join(tmpdir(), `dict-small-${process.pid}.txt`);
    let stderr = "";
    try {
      run(FIXTURE, out);
      throw new Error("应该失败但没有");
    } catch (error) {
      stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    }
    // 断言具体原因，不只看「抛了」—— 任何崩溃都能让 toThrow() 变绿
    expect(stderr).toContain("疑似解析失败");
  });
});
