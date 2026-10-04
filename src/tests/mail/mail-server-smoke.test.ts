import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 真的是起子进程、真的走一遍 MCP 握手。
 *
 * **不要用 shell 管道做这件事**：`printf … | node server` 在 stdin EOF 之后
 * 不会自己退出（SDK 的 StdioServerTransport 没这个语义），管道会挂死。
 * 子进程 + 显式 kill 才能确定地结束。
 */
const BUNDLE = path.join(process.cwd(), "dist-mcp", "mail-server.js");
const hasBundle = fs.existsSync(BUNDLE);

function start(): ChildProcess {
  return spawn(process.execPath, [BUNDLE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // 文件不存在 ⇒ loadAccounts() 返回 {} ⇒ 工具列表照样能列出来
      DESKWAND_MAIL_ACCOUNTS_FILE: path.join(process.cwd(), "dist-mcp", "nonexistent.json"),
    },
  });
}

/** 逐行读 stdout，等第 id 号响应。 */
function waitForResponse(child: ChildProcess, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // 非 JSON 的行（日志之类）直接跳过
        }
        if (parsed?.id === id) {
          child.stdout?.off("data", onData);
          resolve(parsed);
        }
      }
    };
    child.stdout?.on("data", onData);
    setTimeout(() => reject(new Error(`timed out waiting for response ${id}`)), 10_000);
  });
}

describe.skipIf(!hasBundle)("mail server smoke", () => {
  it("handshakes and exposes exactly the five tools", async () => {
    const child = start();
    try {
      child.stdin?.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "smoke", version: "0" },
          },
        })}\n`,
      );
      await waitForResponse(child, 1);
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
      );
      const listed = await waitForResponse(child, 2);
      const names = listed.result.tools.map((t: { name: string }) => t.name).sort();
      expect(names).toEqual([
        "accounts_list",
        "email_respond",
        "email_send",
        "emails_find",
        "emails_save_attachment",
      ]);
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);
});
