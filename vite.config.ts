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
      if (isOAuthModule(id, "anthropic.js")) return transformAnthropic(code);
      if (isOAuthModule(id, "radius.js")) return transformRadius(code);
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

// Single replace — if it doesn't match, the un-patched dynamic imports will
// fail with "Cannot find module" at runtime, which is equally loud.
function transformOpenaiCodex(code: string): string {
  return code.replace(
    `// NEVER convert to top-level imports - breaks browser/Vite builds\nlet _randomBytes = null;\nlet _http = null;\nif (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {\n    import("node:crypto").then((m) => {\n        _randomBytes = m.randomBytes;\n    });\n    import("node:http").then((m) => {\n        _http = m;\n    });\n}\n`,
    `import { randomBytes as _randomBytes } from "node:crypto";\nimport * as _http from "node:http";\n`,
  );
}

function transformAnthropic(code: string): string {
  // Remove lazy nodeApis/getNodeApis pattern, replace with static import.
  code = code.replace(
    "let nodeApis = null;\nlet nodeApisPromise = null;\nconst decode = (s) => atob(s);",
    `import { createServer } from "node:http";\nconst decode = (s) => atob(s);`,
  );
  // Remove getNodeApis function.
  code = code.replace(/async function getNodeApis\(\) \{[\s\S]*?^\}/gm, "");
  // Remove the now-unnecessary await call.
  code = code.replace(
    "    const { createServer } = await getNodeApis();\n",
    "",
  );

  // Assert the function was fully removed so upstream format changes fail
  // at build time rather than silently producing broken output.
  if (code.includes("getNodeApis") || code.includes("nodeApisPromise")) {
    throw new Error(
      "[pi-oauth-electron] Failed to remove getNodeApis from anthropic.js. " +
        "The upstream source format may have changed.",
    );
  }
  return code;
}

// Single replace — runtime "Cannot find module" is equally loud if missed.
function transformRadius(code: string): string {
  return code.replace(
    `// NEVER convert to top-level imports - breaks browser/Vite builds\nlet _http = null;\nif (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {\n    import("node:http").then((m) => {\n        _http = m;\n    });\n}\n`,
    `import * as _http from "node:http";\n`,
  );
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
  },
});
