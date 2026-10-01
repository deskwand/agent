import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // pi-coding-agent resolves its package dir from PI_PACKAGE_DIR first.
    // The DeskWand/pi agent shell exports it pointing into the installed
    // app.asar (unreadable via plain fs) — neutralize it so tests resolve
    // the local node_modules copy.
    env: { PI_PACKAGE_DIR: "" },
    // Resolve Electron to a stable test double so CI does not depend on the
    // postinstall-generated `node_modules/electron/path.txt` file.
    alias: {
      electron: path.resolve(import.meta.dirname, "./tests/mocks/electron.ts"),
    },
    server: {
      deps: {
        inline: ["electron-store"],
      },
    },
    include: [
      "src/**/*.{test,spec}.{js,ts,tsx}",
      "tests/**/*.{test,spec}.{js,ts,tsx}",
    ],
    exclude: ["node_modules", "dist", "dist-electron", ".claude"],
    coverage: {
      provider: "v8",
      // text: human-readable table in CI logs; json-summary: machine-readable for badge tools
      reporter: ["text", "text-summary", "json", "json-summary", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "dist-electron/",
        "src/renderer/",
        "src/tests/",
        "tests/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/mockData",
      ],
      thresholds: {
        lines: 30,
        functions: 35,
        branches: 28,
        statements: 30,
      },
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    // 与 vite.config.ts 同构：dedupe 在**包解析层**生效，子路径（`.../pi-mcp/oauth`）正常走 exports。
    //
    // 不能用字符串别名：Vite 的别名是纯前缀替换，会把子路径拼成 `<别名>/oauth` → 解析失败。
    // 也不能去掉 dedupe：npm 会装出两份 pi-mcp，两份的类不是同一个对象，
    // 上游用 instanceof 判定鉴权/瞬时错误，来自另一份的实例永远认不出来 → needs-auth 不可达。
    //
    // 守卫见 src/tests/mcp/mcp-pi-mcp-single-copy.test.ts。
    dedupe: ["@earendil-works/pi-mcp"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "/@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
