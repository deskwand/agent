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
          plugins: [piOAuthElectronPlugin(), photonWasmPlugin()],
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
