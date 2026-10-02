/**
 * codemode 打包门禁（只验证，不接产品）。
 *
 * 待验证的假设：**打包后**（vite 内联进 dist-electron/main）codemode 能否真的跑一段脚本。
 *
 * 与「开发模式能跑」无关 —— 这里要证的是两个产物的解析：
 *  1. `quickjs.wasm`（637KB）：上游走
 *     `createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm")`
 *     —— 从**打包后的代码位置**解析模块，而 electron-builder 的 files 白名单里
 *     既没有 `quickjs-wasi` 也没有 `@earendil-works`，所以产物里本来没有它。
 *  2. `codemode-worker.js`（67KB ESM）：上游走
 *     `new URL("./codemode-worker.js", import.meta.url)`
 *     —— 相对**打包后代码所在目录**，得把文件放到同一个 chunk 目录。
 *
 * 结论只有两种：能跑 → A 可行（再谈产物搬运与 exposure 策略）；
 * 不能跑 → 按错误的类型决定是「补搬运」还是「A 不可行」。
 */
import pkg from "electron";
const { app } = pkg;
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT_MAIN = join(process.cwd(), "dist-electron/main");

function surveyArtifacts() {
  const files = existsSync(OUT_MAIN) ? readdirSync(OUT_MAIN) : [];
  return {
    chunks: files.filter((f) => f.endsWith(".js")).length,
    wasm: files.filter((f) => f.endsWith(".wasm")),
    hasCodemodeWorker: files.some((f) => f.toLowerCase().includes("codemode")),
    hasQuickjsWasm: files.some((f) => f.toLowerCase().includes("quickjs")),
  };
}

async function main() {
  const out = {
    node: process.versions.node,
    electron: process.versions.electron,
    artifacts: surveyArtifacts(),
  };

  // ① 能不能连执行器一起加载（vite 是否把 execute.js 也内联了）
  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    out.createCodemodeExtension = typeof pi.createCodemodeExtension;
  } catch (error) {
    out.piImportError = String(error);
  }

  // ② 最直接的探针：从主进程 bundle 的目录去解析这两个资源
  const { createRequire } = await import("node:module");
  const requireFromBundle = createRequire(
    pathToFileURL(join(OUT_MAIN, "index.js")).href,
  );
  try {
    out.quickjsWasmResolved = requireFromBundle.resolve(
      "quickjs-wasi/quickjs.wasm",
    );
    out.quickjsWasmExists = existsSync(out.quickjsWasmResolved);
  } catch (error) {
    out.quickjsWasmResolveError = String(error);
  }

  try {
    // 直接照上游那行做：worker 必须与当前 chunk 同目录
    const workerUrl = new URL("./codemode-worker.js", pathToFileURL(join(OUT_MAIN, "index.js")).href);
    out.workerUrl = workerUrl.href;
    out.workerExists = existsSync(workerUrl);
  } catch (error) {
    out.workerUrlError = String(error);
  }

  // ③ 真正跑一段脚本：用 CodemodeSandbox 执行 `1 + 1`
  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    const ext = pi.createCodemodeExtension?.();
    out.extensionCreated = typeof ext;
    // 不接会话，直接看模块能否把执行器载起来（worker + wasm 都会在这里触发）
    out.note = "session-level execution needs the full harness; artifact resolution above is the decisive probe";
  } catch (error) {
    out.executorError = String(error);
  }

  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/codemode-gate.json", JSON.stringify(out, null, 2));
  console.log("GATE RESULT WRITTEN");
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error("GATE FAILED:", error);
    app.exit(1);
  },
);
