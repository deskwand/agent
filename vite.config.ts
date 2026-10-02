import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "path";
import { builtinModules } from "module";

// Node built-in modules must be external for Electron main process
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);
const ignoredWatchPaths = [
  "**/release/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/dist-wsl-agent/**",
  "**/dist-lima-agent/**",
  "**/dist-mcp/**",
];

// Pi SDK's OAuth modules use dynamic import() to evade bundlers (intended for
// browser builds). In Electron's Node.js main process, static imports are safe
// and necessary for Rollup to inline them into the bundle.
const OAUTH_SUFFIX = "/@earendil-works/pi-ai/dist/auth/oauth";
function isOAuthModule(id: string, file: string): boolean {
  const normalized = id.replace(/\\/g, "/");
  return (
    normalized.includes(OAUTH_SUFFIX + "/") && normalized.endsWith(`/${file}`)
  );
}
function piOAuthElectronPlugin(): Plugin {
  return {
    name: "pi-oauth-electron",
    enforce: "pre",
    transform(code, id) {
      if (isOAuthModule(id, "load.js")) return transformLoadJs(code);
      if (isOAuthModule(id, "openai-codex.js"))
        return transformOpenaiCodex(code);
      if (isOAuthModule(id, "anthropic.js"))
        return assertAnthropicCallbackServer(code);
      if (isOAuthModule(id, "radius.js"))
        return assertRadiusCallbackServer(code);
      return null;
    },
  };
}

// --- transforms -----------------------------------------------------------

function transformLoadJs(code: string): string {
  // Replace computed importOAuthModule wrapper with static imports.
  const wrapperRe =
    /var __rewriteRelativeImportExtension[\s\S]*?^const importOAuthModule[\s\S]*?^};\n/gm;
  code = code.replace(wrapperRe, "");

  const staticImports = [
    'import { anthropicOAuth } from "./anthropic.js";',
    'import { openaiCodexOAuth } from "./openai-codex.js";',
    'import { openaiChatGPTOAuth } from "./openai-chatgpt.js";',
    'import { githubCopilotOAuth } from "./github-copilot.js";',
    'import { openRouterOAuth } from "./openrouter.js";',
    'import { kimiCodingOAuth } from "./kimi-coding.js";',
    'import { metaOAuth } from "./meta.js";',
    'import { xaiOAuth } from "./xai.js";',
    'import { createRadiusOAuth } from "./radius.js";',
  ].join("\n");
  code = code.replace(
    "let bundledLoaders;",
    `${staticImports}\nlet bundledLoaders;`,
  );

  // Replace dynamic returns with static references.
  const dyn2static: Record<string, string> = {
    'return (await importOAuthModule("./anthropic.ts")).anthropicOAuth;':
      "return anthropicOAuth;",
    'return (await importOAuthModule("./openai-codex.ts")).openaiCodexOAuth;':
      "return openaiCodexOAuth;",
    // pi-ai 0.99.0 起新增的 Sign in with ChatGPT（loadOpenAIChatGPTOAuth）。
    'return (await importOAuthModule("./openai-chatgpt.ts")).openaiChatGPTOAuth;':
      "return openaiChatGPTOAuth;",
    'return (await importOAuthModule("./github-copilot.ts")).githubCopilotOAuth;':
      "return githubCopilotOAuth;",
    'return (await importOAuthModule("./openrouter.ts")).openRouterOAuth;':
      "return openRouterOAuth;",
    'return (await importOAuthModule("./kimi-coding.ts")).kimiCodingOAuth;':
      "return kimiCodingOAuth;",
    // pi-ai 0.86.1 起新增的 Meta Muse flow（loadMetaOAuth）。
    'return (await importOAuthModule("./meta.ts")).metaOAuth;':
      "return metaOAuth;",
    'return (await importOAuthModule("./xai.ts")).xaiOAuth;':
      "return xaiOAuth;",
    'return (await importOAuthModule("./radius.ts")).createRadiusOAuth(options);':
      "return createRadiusOAuth(options);",
  };
  for (const [from, to] of Object.entries(dyn2static)) {
    code = code.replace(from, to);
  }

  // Assert nothing was missed so upstream format changes fail at build time.
  if (
    code.includes("importOAuthModule") ||
    code.includes("__rewriteRelativeImport")
  ) {
    throw new Error(
      "[pi-oauth-electron] Failed to fully transform load.js. " +
        "The upstream source format may have changed.",
    );
  }
  return code;
}

// 0.99.1 起上游把这里的 _http 惰性加载移出（改走 callback-server.ts），
// 只剩 node:crypto 一段。断言指向**真实的危险**：火并忘的惰性赋值会让
// createState() 误报 "OpenAI Codex OAuth is only available in Node.js
// environments"（_randomBytes 在 .then() 里才被赋值，之后很快就做非空检查）。
//
// 两个方向都不能偏：不能断言「不得残留 import("node:」—— node:crypto 是合法
// 保留项，那会让构建永远失败；也不能只断言那一个字面量 —— 上游若换成别的
// 火并忘惰性导入（历史上 radius.js 的 _http 就是这种），就会静默溜过。
// 因此断言的是模式本身。
function transformOpenaiCodex(code: string): string {
  code = code.replace(
    `// NEVER convert to top-level imports - breaks browser/Vite builds
let _randomBytes = null;
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
    import("node:crypto").then((m) => {
        _randomBytes = m.randomBytes;
    });
}
`,
    `import { randomBytes as _randomBytes } from "node:crypto";\n`,
  );

  if (/import\("node:[a-z0-9_/.-]+"\)\s*\.then\(/.test(code)) {
    throw new Error(
      "[pi-oauth-electron] openai-codex.js still lazily initializes a node builtin " +
        "with a fire-and-forget import().then(). This makes createState() throw " +
        '"OpenAI Codex OAuth is only available in Node.js environments". ' +
        "Re-derive the replace target from " +
        "node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js " +
        "(see design-docs/2026-09-30-pi-sdk-0.99.1-upgrade-design.md §4.2).",
    );
  }
  return code;
}

// 0.99.1 起 anthropic.js 与 radius.js 通过 callback-server.ts 顶层静态导入
// node:http，本仓库原先的两个「动态→静态」变换已成为纯 no-op（要替换的字符串
// 已不存在）。保留为断言而非删除：一旦上游撤销该修复，构建会失败而不是静默坏掉。
// 谓词刻意收窄到「精确的历史痕迹」—— 上游出于浏览器安全而故意使用
// import("node:…") 是合法的，不该被拦。
function assertAnthropicCallbackServer(code: string): null {
  if (code.includes("getNodeApis") || code.includes("nodeApisPromise")) {
    throw new Error(
      "[pi-oauth-electron] anthropic.js reintroduced the lazy getNodeApis() pattern. " +
        "Re-apply a static node:http import transform (see design §3.1).",
    );
  }
  return null;
}

function assertRadiusCallbackServer(code: string): null {
  // 注意谓词是**故意收窄**的：`let _http = null;` 是历史痕迹的字面量，
  // 若上游换个变量名重新引入惰性 node:http，这里会静默漏过 —— 那是接受的
  // 代价（放宽会挡住上游合法的惰性导入，见 design §4.2）。
  if (
    code.includes("let _http = null;") &&
    /import\("node:http"\)\s*\.then/.test(code)
  ) {
    throw new Error(
      "[pi-oauth-electron] radius.js reintroduced the fire-and-forget node:http import, " +
        'which makes startOAuthCallbackServer() throw "only available in Node.js ' +
        'environments" (see design §3.1).',
    );
  }
  return null;
}

/**
 * pi SDK 会把 @silvia-odwyer/photon-node 的 Emscripten glue 内联进主进程 bundle
 * （dist-electron/main/photon_rs-<hash>.js），而那段 glue 读的是
 * `path.join(__dirname, "photon_rs_bg.wasm")` —— Rollup 看不见这种运行期拼出来的路径，
 * 所以没人把 wasm 拷进产物目录（SDK 自己的兜底只看 dirname(process.execPath) / cwd，
 * 打包后都不存在）。结果 loadPhoton() 返回 null，任何图片（贴图 / 附图 / read 图片文件）
 * 都会退化成 "[Image omitted: could not be resized …]"。
 * 把 wasm 放到 chunk 同目录，即 glue 的第一顺位查找位置。
 */
function photonWasmPlugin(): Plugin {
  const candidates = [
    resolve(
      process.cwd(),
      "node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm",
    ),
    resolve(
      process.cwd(),
      "node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm",
    ),
  ];
  return {
    name: "photon-wasm",
    closeBundle() {
      const source = candidates.find((candidate) => existsSync(candidate));
      if (!source) {
        throw new Error(
          `[photon-wasm] photon_rs_bg.wasm not found. Looked in:\n  ${candidates.join("\n  ")}`,
        );
      }
      const outDir = resolve(process.cwd(), "dist-electron/main");
      mkdirSync(outDir, { recursive: true });
      copyFileSync(source, resolve(outDir, "photon_rs_bg.wasm"));
    },
  };
}

/**
 * codemode 的两个运行期产物，必须与主进程 chunk 同目录/可解析。
 *
 * 上游的查找方式是写死的（`isBundledNode = true`）：
 *  - worker：`new URL("./codemode-worker.js", import.meta.url)` —— 相对 chunk 所在目录
 *  - wasm  ：`createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm")` —— 从 chunk 位置做模块解析
 * 两者都不在 electron-builder 的 `files` 白名单里（pi-coding-agent 是靠 vite 内联的），
 * 所以没人把它们拷进产物目录。
 *
 * 不泛化 `photonWasmPlugin`：那个是 25 行自成一体且正在生产里工作，而两者目标形状不同
 * （photon 只搬 1 个文件到 outDir；codemode 还要多搬 1 个到 `outDir/node_modules/quickjs-wasi/`）。
 */
function codemodeArtifactsPlugin(): Plugin {
  const piCodemodeRoot = resolve(
    process.cwd(),
    "node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks",
  );
  const workerCandidates = [resolve(piCodemodeRoot, "codemode-worker.js")];
  const wasmCandidates = [
    resolve(
      process.cwd(),
      "node_modules/@earendil-works/pi-coding-agent/node_modules/quickjs-wasi/quickjs.wasm",
    ),
    resolve(process.cwd(), "node_modules/quickjs-wasi/quickjs.wasm"),
  ];
  return {
    name: "codemode-artifacts",
    closeBundle() {
      const outDir = resolve(process.cwd(), "dist-electron/main");
      mkdirSync(outDir, { recursive: true });

      const worker = workerCandidates.find((candidate) => existsSync(candidate));
      if (!worker) {
        throw new Error(
          `[codemode-artifacts] codemode-worker.js not found. Looked in:\n  ${workerCandidates.join("\n  ")}`,
        );
      }
      copyFileSync(worker, resolve(outDir, "codemode-worker.js"));

      const wasm = wasmCandidates.find((candidate) => existsSync(candidate));
      if (!wasm) {
        throw new Error(
          `[codemode-artifacts] quickjs.wasm not found. Looked in:\n  ${wasmCandidates.join("\n  ")}`,
        );
      }
      // 上游的 `createRequire(...).resolve("quickjs-wasi/quickjs.wasm")` 从 chunk 位置向上找
      // `node_modules/quickjs-wasi/`，所以放这里。
      const wasmDir = resolve(outDir, "node_modules/quickjs-wasi");
      mkdirSync(wasmDir, { recursive: true });
      copyFileSync(wasm, resolve(wasmDir, "quickjs.wasm"));
    },
  };
}

/**
 * `@earendil-works/pi-mcp` 打包后必须**只有一个模块实例** —— 由两处 `resolve.dedupe` 保证：
 * 顶层 `resolve`（renderer）与主进程 entry 的内嵌 `vite.resolve`（app 的 MCP 代码编在那里，
 * 且内嵌配置**不继承**顶层 resolve）。
 *
 * 为什么必须这样（评审 blocker）：npm 会装出两份 pi-mcp（顶层 + pi-coding-agent 的
 * shrinkwrap 锁定的一份），两份的类**不是同一个对象** —— `a.StdioTransport === b.StdioTransport`
 * 为 false。上游 `extensions/mcp/runtime.js` 用 `instanceof McpAuthRequiredError /
 * McpSessionExpiredError / McpHttpError / StdioTransport` 判定鉴权与瞬时错误，所以自建传输
 * 只要来自另一份，鉴权错误就永远认不出来 → `needs-auth` 与 `/mcp` 登录流程不可达，
 * 而 OAuth 正是本次用内置实现替换自研客户端的全部理由。
 *
 * 为什么不用字符串别名：Vite 的别名是**纯前缀替换**，不查 `exports`，会把上游的
 * `@earendil-works/pi-mcp/oauth` 拼成 `<别名>/oauth` → 构建失败（实测）。dedupe 在包解析层
 * 生效，子路径正常走 `exports`。
 *
 * 改这里等于破坏 OAuth —— 守卫见 src/tests/mcp/mcp-pi-mcp-single-copy.test.ts。
 */
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "src/main/index.ts",
        onstart(args) {
          args.startup();
        },
        vite: {
          plugins: [
            piOAuthElectronPlugin(),
            photonWasmPlugin(),
            codemodeArtifactsPlugin(),
          ],
          // 主进程有自己这份内嵌 vite 配置，**不继承**顶层 resolve ——
          // 所以 dedupe 必须在这里再声明一次（app 的 MCP 代码就编在这里）。
          resolve: {
            dedupe: ["@earendil-works/pi-mcp"],
          },
          build: {
            outDir: "dist-electron/main",
            emptyOutDir: true,
            rollupOptions: {
              external: [
                ...nodeBuiltins,
                "bufferutil",
                "utf-8-validate",
                "electron",
                // Externalize large CJS-compatible main-process dependencies
                // NOTE: ESM-only packages (pi-coding-agent, pi-ai, electron-store, uuid)
                // must stay bundled — CJS require() can't load them
                "@anthropic-ai/sdk",
                "@larksuiteoapi/node-sdk",
                "openai",
                "@modelcontextprotocol/sdk",
                "electron-updater",
                "chokidar",
                "fsevents",
                "archiver",
                "ngrok",
                "ws",
                "glob",
                "dotenv",
                "jsdom",
                "canvas",
                // playwright-core bundles chromium-bidi internally via lazy require;
                // Vite's CJS plugin hoists those to top-level static requires so we
                // must keep playwright-core external to preserve its own loader logic.
                "playwright-core",
                // node:sqlite was added in Node 22 and is not listed in
                // module.builtinModules — must be externalized explicitly.
                "node:sqlite",
                // pdfjs-dist's internal dynamic import of pdf.worker.mjs gets
                // resolved by Rollup to the dist output dir. Keep it external.
                "pdfjs-dist/legacy/build/pdf.worker.mjs",
                // @napi-rs/canvas is a native addon used by pdfjs-dist's
                // NodeCanvasFactory for page rendering (image-only PDF pages).
                // Native addons must not be bundled.
                "@napi-rs/canvas",
              ],
              output: {
                // Ensure consistent interop for CJS/ESM
                interop: "auto",
              },
            },
          },
        },
      },
      {
        entry: "src/preload/index.ts",
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        entry: "src/preload/pet.ts",
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: { external: ["electron"] },
          },
        },
      },
    ]),
  ],

  resolve: {
    // dedupe 在**包解析层**生效（字符串别名做不到 —— 它会把 `.../pi-mcp/oauth`
    // 这种子路径拼成 `<别名>/oauth`）。上游 runtime.js 同时用 `.` 与 `./oauth`，
    // 所以只能用 dedupe。见文件顶部 PI_MCP_ROOT 的说明。
    dedupe: ["@earendil-works/pi-mcp"],
    alias: {
      "@": resolve(__dirname, "src"),
      "@main": resolve(__dirname, "src/main"),
      "@renderer": resolve(__dirname, "src/renderer"),
    },
  },
  server: {
    watch: {
      ignored: ignoredWatchPaths,
    },
  },
  build: {
    sourcemap: process.env.NODE_ENV !== "production",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        pet: resolve(__dirname, "pet.html"),
      },
    },
  },
});
