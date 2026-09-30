import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const TOP_LEVEL = path.join(ROOT, "node_modules/@earendil-works/pi-mcp");
const NESTED = path.join(
  ROOT,
  "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-mcp",
);

/**
 * 这个文件守的是**评审 blocker**：`pi-mcp` 在磁盘上只能有一份。
 *
 * 两份时的后果不是「多占点空间」，而是**类身份不同**：
 * `a.StdioTransport === b.StdioTransport` 为 false。上游
 * `extensions/mcp/runtime.js` 用 `instanceof McpAuthRequiredError / McpSessionExpiredError /
 * McpHttpError / StdioTransport` 判定鉴权与瞬时错误，所以自建传输只要来自另一份，
 * 鉴权错误就永远认不出来 → `needs-auth` 与 `/mcp` 登录流程不可达，而 OAuth 正是本次
 * 用内置实现替换自研客户端的全部理由。
 */
describe("pi-mcp must exist as a single copy", () => {
  it("keeps exactly one copy on disk, and it is the one upstream uses", () => {
    expect(fs.existsSync(NESTED), `nested copy missing: ${NESTED}`).toBe(true);
    expect(
      fs.existsSync(TOP_LEVEL),
      "a top-level pi-mcp was installed again — two copies break instanceof class identity",
    ).toBe(false);
  });

  it("aliases @earendil-works/pi-mcp to upstream's copy in both bundler configs", () => {
    const vite = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    const vitest = fs.readFileSync(
      path.join(ROOT, "vitest.config.mts"),
      "utf8",
    );
    const rel =
      "@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-mcp";
    expect(vite).toContain(rel);
    expect(vitest).toContain(rel);
  });

  it("resolves the alias and the raw file to the same module instance", async () => {
    const viaAlias = await import("@earendil-works/pi-mcp");
    const viaFile = await import(
      pathToFileURL(path.join(NESTED, "dist/index.js")).href
    );
    // 同一份文件 → 同一个类对象。若别名指错地方，这里就会是 false。
    expect(viaAlias.StdioTransport).toBe(viaFile.StdioTransport);
    expect(viaAlias.McpAuthRequiredError).toBe(viaFile.McpAuthRequiredError);
  });
});
