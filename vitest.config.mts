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
    alias: {
      // 见 vite.config.ts 里的 PI_MCP_ROOT 说明：必须与上游解析到同一份，
      // 否则 instanceof 判定失效、needs-auth 不可达。
      "@earendil-works/pi-mcp": path.resolve(
        import.meta.dirname,
        "./node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-mcp/dist/index.js",
      ),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
