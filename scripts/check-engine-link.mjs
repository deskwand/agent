// 引擎的「能不能链接」自检。
//
// 为什么不用退出码：上游 `tts-server --help` 的退出码是 **1**（实测），
// 打印完用法就退出 1。把它当失败会误报，改成"0 才算过"又验不到东西。
//
// 判据是两件事，缺一不可：
//   1. 输出里没有动态库加载失败的痕迹（dyld / Library not loaded / Win 的对应字样）；
//   2. 输出里有 `Usage:` 横幅 —— 说明 main() 真的跑起来了。
// 这两条一起才能区分"能链接"与"编出来了但库找不齐"。
import { spawnSync } from "node:child_process";

const bin = process.env.BIN;
if (!bin) throw new Error("BIN is required");

const result = spawnSync(bin, ["--help"], { encoding: "utf8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

const LINK_ERROR =
  /Library not loaded|image not found|dyld|error while loading shared libraries|The code execution cannot proceed|cannot find the path/i;
if (LINK_ERROR.test(output)) {
  console.error("link check failed: a dynamic library is missing");
  process.exit(1);
}
if (!/Usage:/.test(output)) {
  console.error(`link check failed: no usage banner (exit ${result.status})`);
  process.exit(1);
}
console.log("OK: engine starts and prints usage");
