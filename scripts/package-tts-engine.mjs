// 把 CI 编译出来的二进制与动态库收进 bin/，打 tar.gz，打印 sha256 与体积。
//
// 产物里必须带许可证：上游是 MIT，两个模型是 Apache-2.0（第三方模型另有声明）。
// 我们只分发上游编出来的东西，不改它一行 —— 需要改就以 PR 提交上游（见设计 §4.2）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, join } from "node:path";

const commit = process.env.UPSTREAM_COMMIT ?? "6fae929";
const platform = process.env.PLATFORM; // darwin-arm64 | win32-x64
const build = process.env.BUILD_DIR; // 上游 build 目录
const upstream = process.env.ENGINE_SRC ?? "/tmp/qwentts";

if (!platform || !build) {
  throw new Error("PLATFORM and BUILD_DIR are required");
}

const name = `qwentts-server-${commit}-${platform}`;
const out = join("dist", name);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "bin"), { recursive: true });

// 可执行文件 + 它的动态库（Metal/Vulkan 后端在 macOS/Windows 上都是独立库）
for (const file of readdirSync(build)) {
  if (
    /^(tts-server|qwen-tts)(\.exe)?$/.test(file) ||
    /\.(dylib|dll)$/.test(file)
  ) {
    cpSync(join(build, file), join(out, "bin", file));
  }
}
cpSync(join(upstream, "LICENSE"), join(out, "LICENSE"));

/**
 * 把符号链接改成**同目录的相对链接**。
 *
 * 上游构建树里的版本链接是绝对路径（`libggml.0.dylib -> /tmp/qwentts/build/libggml.0.25.3.dylib`）。
 * 那样打出来的包只在那台构建机上可用 —— 用户机器上 dyld 顺着链接找不到文件，
 * 症状和 rpath 写错一模一样（`Library not loaded: @rpath/libggml.0.dylib`）。
 * 产物把所有 dylib 平铺在 bin/ 里，所以链接只要写文件名。
 */
for (const file of readdirSync(join(out, "bin"))) {
  const dest = join(out, "bin", file);
  if (!lstatSync(dest).isSymbolicLink()) continue;
  // 用 readlink 取目标名，不用 realpath：解析链接**不要求目标此刻存在**
  const target = basename(readlinkSync(dest));
  rmSync(dest);
  symlinkSync(target, dest);
}

/**
 * macOS：把 rpath 从**构建机的绝对路径**改成 `@loader_path`。
 *
 * 为什么必须有这一步：上游 CMake 给可执行文件写的是绝对 rpath
 * （实测 `/tmp/qwentts/build`）。那个目录只存在于构建机 —— 用户机器上没有，
 * 于是 dyld 找不到 libggml，引擎根本起不来。
 *
 * 而且这个坑很难在开发机上看出来：构建目录还在时，dyld 会**悄悄**从那里取库，
 * 你从解包副本跑也"能跑"（假阳性）。所以自检必须先把构建目录移开（见 workflow）。
 *
 * 产物把所有 dylib 平铺在 bin/ 里，所以 `@loader_path` 一条就够。
 * 改过 Mach-O 后必须重新 ad-hoc 签名，否则 arm64 上内核会直接杀掉进程。
 */
if (platform.startsWith("darwin")) {
  const strip = (file) => {
    const binary = join(out, "bin", file);
    if (lstatSync(binary).isSymbolicLink()) return; // 只动真文件
    // LC_RPATH 块里的那一行形如 `path /some/dir (offset 12)`。
    // 别按"上一行是 LC_RPATH"来筛：中间还夹着 cmdsize 行（踩过，会把 cmdsize 当路径）。
    const rpaths = [
      ...execFileSync("otool", ["-l", binary], { encoding: "utf8" }).matchAll(
        /^\s*path (.+?) \(offset \d+\)$/gm,
      ),
    ].map((match) => match[1]);
    for (const rpath of rpaths) {
      if (rpath === "@loader_path") continue;
      execFileSync("install_name_tool", ["-delete_rpath", rpath, binary]);
    }
    if (!rpaths.includes("@loader_path")) {
      execFileSync("install_name_tool", ["-add_rpath", "@loader_path", binary]);
    }
    // 签名与内容绑定，改完必须重签（ad-hoc 就够，我们不做公证）
    execFileSync("codesign", ["--force", "--sign", "-", binary], {
      stdio: "ignore",
    });
  };
  for (const file of readdirSync(join(out, "bin"))) {
    strip(file);
  }
}

const tarFile = join("dist", `${name}.tar.gz`);
execFileSync("tar", ["-czf", tarFile, "-C", "dist", name]);
const bytes = statSync(tarFile).size;
const sha256 = createHash("sha256").update(readFileSync(tarFile)).digest("hex");
console.log(`${tarFile}\n  bytes=${bytes}\n  sha256=${sha256}`);
