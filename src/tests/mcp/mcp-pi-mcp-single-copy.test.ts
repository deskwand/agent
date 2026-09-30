import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const TOP_LEVEL = path.join(ROOT, "node_modules/@earendil-works/pi-mcp");

/**
 * 这个文件守的是**评审 blocker**：应用打包后 `pi-mcp` 只能有**一个模块实例**。
 *
 * 两份时的后果不是「多占点空间」，而是**类身份不同**：
 * `a.StdioTransport === b.StdioTransport` 为 false。上游
 * `extensions/mcp/runtime.js` 用 `instanceof McpAuthRequiredError / McpSessionExpiredError /
 * McpHttpError / StdioTransport` 判定鉴权与瞬时错误，所以自建传输只要来自另一份，
 * 鉴权错误就永远认不出来 → `needs-auth` 与 `/mcp` 登录流程不可达，而 OAuth 正是本次
 * 用内置实现替换自研客户端的全部理由。
 *
 * 为什么不是「别名到嵌套那一份」：Vite 的字符串别名是**纯前缀替换**，不查 `exports`，
 * 会把上游的 `@earendil-works/pi-mcp/oauth` 拼成 `<别名>/oauth` → 构建失败（实测）。
 * 所以用 `resolve.dedupe` —— 它在包解析层生效，子路径正常走 `exports`。
 *
 * 为什么要在**主进程**配置里也写一遍：`vite-plugin-electron` 的每个 entry 有自己的内嵌
 * vite 配置，**不继承**顶层 resolve。应用的主进程代码就编在那里面（漏了会让构建直接报
 * `Rollup failed to resolve import`）。
 */
describe("pi-mcp must collapse to a single module instance in the bundle", () => {
  it("declares resolve.dedupe for @earendil-works/pi-mcp in the main-process vite config", () => {
    const vite = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    const occurrences =
      vite.match(/dedupe:\s*\["@earendil-works\/pi-mcp"\]/g) ?? [];
    // 顶层（renderer）+ 主进程内嵌 entry，两处都要有
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a top-level copy for dedupe to resolve to", () => {
    // dedupe 会把所有引用解析到**项目根**的这一份；它不存在时构建会直接失败
    expect(fs.existsSync(TOP_LEVEL), `missing: ${TOP_LEVEL}`).toBe(true);
  });

  it("keeps the two installed copies on the same version so dedupe is semantically safe", () => {
    const read = (dir: string) =>
      JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
        .version;
    const nested = path.join(
      ROOT,
      "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-mcp",
    );
    expect(read(TOP_LEVEL)).toBe(read(nested));
  });
});
