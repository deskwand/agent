import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerConnectorsIpc } from "../../main/connectors";
import { upsertMailAccount } from "../../main/mail/account-store";
import {
  setServerEnabled,
  upsertServer,
} from "../../main/connectors/mcp-config-file";
import type { ConnectorEntry } from "../../shared/connectors";

/**
 * 守的是**生产接线**，不是 `buildRegistry` 本身。
 *
 * 为什么单独要这一条：`RegistryDeps` 的 `loadMailAccounts` / `isMailServerEnabled`
 * 是**可选**的（设成必填会让既有的 registry/e2e 测试在 list() 里抛 TypeError）。
 * 可选 + 有默认值 = 忘记接线也不会报错：
 *   - 漏了 `loadMailAccounts` ⇒ 邮箱条目一个都不出现（静默的空列表）
 *   - 漏了 `isMailServerEnabled` ⇒ 每条邮箱都显示「未启用」
 * 两种都是「没有报错、没有警告，用户只看到自己的邮箱不见了」。
 * 既有的 e2e 测试自己拼 deps，所以它只能测到它自己那份，测不到 connectors/index.ts。
 *
 * 这里直接调 `registerConnectorsIpc`，走真实的那份接线。
 */

/** 捕获 ipcMain.handle 注册的处理器，直接调用 —— 不真起 Electron。 */
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

const ACCOUNT = (email: string) => ({
  providerId: "qq" as const,
  credential: "abcd1234efgh5678",
  imap: { host: "imap.qq.com", port: 993, secure: true, user: email },
  smtp: { host: "smtp.qq.com", port: 465, secure: true, user: email },
});

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-wiring-"));
  ipc = fakeIpcMain();
  registerConnectorsIpc({
    ipcMain: ipc as never,
    agentDir,
    openUrl: () => {},
    sendToRenderer: () => {},
    activateMcpServer: () => true,
  });
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
});

async function mailEntries(): Promise<ConnectorEntry[]> {
  const all = (await ipc.call("connectors.list")) as ConnectorEntry[];
  return all.filter((e) => e.source === "mail");
}

describe("mailbox registry wiring (production deps)", () => {
  it("surfaces a mailbox that is on disk — the wiring is real, not a silently empty list", async () => {
    upsertMailAccount(agentDir, "a@qq.com", ACCOUNT("a@qq.com"));
    const entries = await mailEntries();
    expect(entries.map((e) => e.key)).toEqual(["mail:a@qq.com"]);
    expect(entries[0].serverName).toBe("Mail");
  });

  it("reports every mailbox, not just the first", async () => {
    upsertMailAccount(agentDir, "a@qq.com", ACCOUNT("a@qq.com"));
    upsertMailAccount(agentDir, "b@qq.com", ACCOUNT("b@qq.com"));
    expect((await mailEntries()).map((e) => e.key)).toEqual([
      "mail:a@qq.com",
      "mail:b@qq.com",
    ]);
  });

  it("is NOT off when the mail server hasn't been written to mcp.json yet", async () => {
    // `?? false` 的默认值会让漏接的 isMailServerEnabled 把每条邮箱都变成「未启用」。
    // 一个刚从磁盘读到的账号，状态应该是 idle，不是 off。
    upsertMailAccount(agentDir, "a@qq.com", ACCOUNT("a@qq.com"));
    const [entry] = await mailEntries();
    expect(entry.instances[0].status).toEqual({ kind: "idle" });
  });

  it("keeps the mailbox usable while Mail is present and enabled", async () => {
    upsertMailAccount(agentDir, "a@qq.com", ACCOUNT("a@qq.com"));
    upsertServer(agentDir, "Mail", {
      type: "stdio",
      command: "node",
      args: ["/x.js"],
    });
    const [entry] = await mailEntries();
    expect(entry.instances[0].status).toEqual({ kind: "idle" });
  });

  it("only reports off when Mail is explicitly disabled", async () => {
    upsertMailAccount(agentDir, "a@qq.com", ACCOUNT("a@qq.com"));
    upsertServer(agentDir, "Mail", {
      type: "stdio",
      command: "node",
      args: ["/x.js"],
    });
    setServerEnabled(agentDir, "Mail", false);
    const [entry] = await mailEntries();
    expect(entry.instances[0].status).toEqual({ kind: "off" });
  });

  it("groups mailboxes into the mail section, not the self-hosted one", async () => {
    upsertMailAccount(agentDir, "a@qq.com", ACCOUNT("a@qq.com"));
    const [entry] = await mailEntries();
    // 视图按 `entry.category ?? (source === "mail" ? "mail" : "other")` 分组，
    // 所以邮箱条目必须不带 category —— 带了就会落到那个分类里。
    expect(entry.category).toBeUndefined();
  });
});
