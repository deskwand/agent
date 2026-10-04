import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MAIL_SERVER_NAME, registerMailIpc } from "../../main/mail/ipc";
import {
  readMailAccounts,
  upsertMailAccount,
} from "../../main/mail/account-store";

/**
 * 这一层守两件在生产里会静默出错的事：
 *  1. server 名恰好是 `Mail` —— 工具名发布为 `mcp__Mail__*`，改名会破坏提示词缓存；
 *  2. 删掉最后一个邮箱后 `mcp.json` 里不留空 server —— 那是 `retired-presets.ts`
 *     处理过的同一类残留，只是这次由我们自己产生。
 */

/** 捕获 ipcMain.handle 注册的处理器，直接调用它们 —— 不真起 Electron。 */
function fakeIpcMain(): {
  handle: (channel: string, fn: (...a: unknown[]) => unknown) => void;
  call: (channel: string, ...a: unknown[]) => Promise<any>;
} {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    async call(channel, ...a) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return (await fn({}, ...a)) as any;
    },
  };
}

let agentDir: string;
let ipc: ReturnType<typeof fakeIpcMain>;
let upserted: Array<{ name: string; config: unknown }>;
let removed: string[];
let activated: Array<{ name: string; config: unknown }>;

const account = (email: string) => ({
  providerId: "qq" as const,
  credential: "x",
  imap: { host: "imap.qq.com", port: 993, secure: true, user: email },
  smtp: { host: "smtp.qq.com", port: 465, secure: true, user: email },
});

function register(
  connect: unknown,
  resolveServerScript: () => string | null = () =>
    "/fake/dist-mcp/mail-server.js",
): void {
  registerMailIpc({
    ipcMain: ipc as never,
    agentDir,
    activateMcpServer: (name, config) => {
      activated.push({ name, config });
      return true;
    },
    connect: connect as never,
    upsertServer: (_dir, name, config) => upserted.push({ name, config }),
    removeServer: (_dir, name) => {
      removed.push(name);
      return true;
    },
    resolveServerScript,
    sendToRenderer: () => {},
  });
}

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-ipc-"));
  upserted = [];
  removed = [];
  activated = [];
  ipc = fakeIpcMain();
  register(async () => ({
    ok: true,
    imap: { host: "imap.qq.com", port: 993, secure: true, user: "a@qq.com" },
    smtp: { host: "smtp.qq.com", port: 465, secure: true, user: "a@qq.com" },
  }));
});

describe("mail ipc", () => {
  it("pins the MCP server name — tool names are published as mcp__Mail__* and cannot change", () => {
    expect(MAIL_SERVER_NAME).toBe("Mail");
  });

  it("writes the mailbox and registers the server under that exact name", async () => {
    const res = await ipc.call("mail.addAccount", {
      providerId: "qq",
      email: "a@qq.com",
      credential: "abcd1234efgh5678",
    });
    expect(res.ok).toBe(true);
    expect(Object.keys(readMailAccounts(agentDir))).toEqual(["a@qq.com"]);
    expect(upserted.map((u) => u.name)).toEqual(["Mail"]);
    expect(activated.map((a) => a.name)).toEqual(["Mail"]);
  });

  it("writes nothing at all when the connectivity test fails", async () => {
    ipc = fakeIpcMain();
    register(async () => ({ ok: false, message: "auth failed" }));
    const res = await ipc.call("mail.addAccount", {
      providerId: "qq",
      email: "a@qq.com",
      credential: "wrong",
    });
    expect(res.ok).toBe(false);
    expect(readMailAccounts(agentDir)).toEqual({});
    expect(upserted).toEqual([]);
  });

  it("clears the Mail entry from mcp.json once the last mailbox is gone", async () => {
    upsertMailAccount(agentDir, "a@qq.com", account("a@qq.com"));
    await ipc.call("mail.removeAccount", "a@qq.com");
    expect(removed).toEqual(["Mail"]);
    expect(readMailAccounts(agentDir)).toEqual({});
  });

  it("keeps the Mail entry while another mailbox remains", async () => {
    upsertMailAccount(agentDir, "a@qq.com", account("a@qq.com"));
    upsertMailAccount(agentDir, "b@qq.com", account("b@qq.com"));
    await ipc.call("mail.removeAccount", "a@qq.com");
    expect(removed).toEqual([]);
  });

  it("never returns a credential to the renderer", async () => {
    upsertMailAccount(agentDir, "a@qq.com", {
      ...account("a@qq.com"),
      credential: "SECRETCODE123456",
    });
    const listed = await ipc.call("mail.listAccounts");
    expect(JSON.stringify(listed)).not.toContain("SECRETCODE123456");
    expect(listed).toEqual([
      { email: "a@qq.com", providerId: "qq", lastCheck: undefined },
    ]);
  });
});

describe("mail ipc — build without the server bundle", () => {
  it("writes nothing AND does not even test connectivity when mail-server.js is absent", async () => {
    // 这条守的是一个会留下垃圾状态的顺序问题：如果先测连通性、先落盘，再去解析脚本路径，
    // 那么一个缺了 mail-server.js 的构建会把账号写进磁盘 —— 用户看到邮箱「加上了」，
    // 但它永远连不上，因为 server 根本不存在。正确的顺序是先解析、失败即返回。
    let connectCalls = 0;
    ipc = fakeIpcMain();
    register(async () => {
      connectCalls += 1;
      return { ok: true };
    }, () => null);

    const res = await ipc.call("mail.addAccount", {
      providerId: "qq",
      email: "a@qq.com",
      credential: "abcd1234efgh5678",
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mail-server\.js/);
    expect(readMailAccounts(agentDir)).toEqual({});
    expect(upserted).toEqual([]);
    expect(activated).toEqual([]);
    // 连网络都不该碰：脚本都不在，测了也没意义
    expect(connectCalls).toBe(0);
  });
});
