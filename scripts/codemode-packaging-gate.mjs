/**
 * codemode 打包门禁。
 *
 * **上一次它是假绿的**：它用我自己构造的 `new URL("./codemode-worker.js", …)` 去断言，
 * 也就是验的是**我的假设**，而不是产物真实的查找路径。结果用户实测报
 * `Cannot find module '<app.asar>/dist-electron/main/worker.js'` —— 真实查找的是
 * `./worker.js`（`defaultWorkerUrl()` 的回落），而我根本没拷那个名字。
 *
 * 所以现在的做法：**从产物自身的字面量推导它需要哪些 worker 文件**，再逐个断言存在、
 * 且内容自包含。（存在但 import 不到裸包同样会挂 —— 340 字节的转发 shim 就是这种情况。）
 */
import pkg from "electron";
const { app } = pkg;
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT_MAIN = join(process.cwd(), "dist-electron/main");

/** 产物引用的同目录 worker 文件名（形如 `"./xxxworker.js"`）。 */
function requiredWorkerFiles() {
  const names = new Set();
  for (const file of readdirSync(OUT_MAIN)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(join(OUT_MAIN, file), "utf8");
    for (const match of source.matchAll(/"\.\/([A-Za-z0-9_.-]*worker\.js)"/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** 该文件是否自包含（不含会解析失败的裸包 import）。 */
function isSelfContained(name) {
  const source = readFileSync(join(OUT_MAIN, name), "utf8");
  return !/from\s*"@earendil-works|require\("@earendil-works/.test(source);
}

async function main() {
  const out = {
    node: process.versions.node,
    electron: process.versions.electron,
    requiredWorkers: [],
    missingWorkers: [],
    notSelfContained: [],
  };

  for (const name of requiredWorkerFiles()) {
    out.requiredWorkers.push(name);
    if (!existsSync(join(OUT_MAIN, name))) {
      out.missingWorkers.push(name);
    } else if (!isSelfContained(name)) {
      out.notSelfContained.push(name);
    }
  }

  // wasm：上游走 createRequire(<chunk 位置>).resolve("quickjs-wasi/quickjs.wasm")
  const { createRequire } = await import("node:module");
  const requireFromBundle = createRequire(
    pathToFileURL(join(OUT_MAIN, "index.js")).href,
  );
  try {
    const resolved = requireFromBundle.resolve("quickjs-wasi/quickjs.wasm");
    out.quickjsWasmResolved = resolved;
    out.quickjsWasmExists = existsSync(resolved);
  } catch (error) {
    out.quickjsWasmResolveError = String(error);
  }

  out.ok =
    out.missingWorkers.length === 0 &&
    out.notSelfContained.length === 0 &&
    out.quickjsWasmExists === true;

  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/codemode-gate.json", JSON.stringify(out, null, 2));
  console.log(out.ok ? "GATE OK" : "GATE FAILED");
  if (!out.ok) console.log(JSON.stringify(out, null, 2));
}

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error("GATE ERROR:", error);
      app.exit(1);
    },
  );
