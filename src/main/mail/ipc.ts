/**
 * 邮箱账号的 IPC 入口。照 `registerConnectorsIpc` 的形状写：
 * `ipcMain` 与 `agentDir` 都是注入的，不在模块顶层 import electron 的值 ——
 * 这样本模块能被单测直接 import。
 *
 * **凭据永不进渲染层**：`listAccounts` 一律走 `toAccountView`。
 */
import type { IpcMain } from "electron";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import {
  toAccountView,
  type AddMailAccountInput,
  type MailAccount,
} from "../../shared/mail-accounts";
import {
  readMailAccounts,
  removeMailAccount,
  setMailAccountCheck,
  upsertMailAccount,
} from "./account-store";
import type { connectAndTest} from "./connect";
import { testMailAccount } from "./connect";
import { mailServerConfig } from "./mail-server-config";

/** **不能改**：工具名是 `mcp__Mail__*`。 */
export const MAIL_SERVER_NAME = "Mail";

/**
 * `addAccount` 的入参形状。定义在 `src/shared/mail-accounts.ts` —— 它跨 IPC 边界
 * （渲染层提交、主进程消费），AGENTS.md §4 要求共享类型统一放 shared。
 * 这里只是转发，方便主进程侧就地引用。
 */
export type { AddMailAccountInput } from "../../shared/mail-accounts";

export interface RegisterMailIpcArgs {
  ipcMain: IpcMain;
  agentDir: string;
  /** 让 SDK 立刻连上新 server；没有活跃会话时返回 false */
  activateMcpServer: (name: string, config: McpServerConfig) => boolean;
  /** 连通性测试。注入而不是直接 import —— 照 `buildRegistry(deps)` 的惯例，
   *  这样 IPC 层的分支（首测失败、最后一个邮箱删掉后的清理）不联网也能测。 */
  connect: typeof connectAndTest;
  /** 写 mcp.json。注入以便单测。 */
  upsertServer: (agentDir: string, name: string, config: McpServerConfig) => void;
  removeServer: (agentDir: string, name: string) => boolean;
  /** 解析随包分发的 mail-server.js 路径 */
  resolveServerScript: () => string | null;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

export function registerMailIpc(args: RegisterMailIpcArgs): void {
  const { ipcMain, agentDir, sendToRenderer } = args;

  ipcMain.handle("mail.listAccounts", () =>
    Object.entries(readMailAccounts(agentDir)).map(([email, account]) =>
      toAccountView(email, account),
    ),
  );

  ipcMain.handle("mail.addAccount", async (_e, input: AddMailAccountInput) => {
    // 脚本都找不到的构建没有可落盘的配置，先失败，连测试都不必发。
    const script = args.resolveServerScript();
    if (!script) {
      return { ok: false, error: "mail-server.js not found in this build" };
    }

    const connected = await args.connect(input);
    if (!connected.ok) {
      // **先测后写**：失败时**什么都不落盘** ——
      // 不留下连不上的账号，也不给它写 lastCheck（那个字段只在账号存在时才有意义）。
      // 错误直接回对话框，用户还能改一个字符再试。
      return { ok: false, error: connected.message };
    }

    const account: MailAccount = {
      providerId: input.providerId,
      credential: input.credential,
      imap: connected.imap,
      smtp: connected.smtp,
      lastCheck: { ok: true, at: Date.now() },
    };
    upsertMailAccount(agentDir, input.email, account);

    // 首次添加时把 Mail 写进 mcp.json 并让它立刻生效
    const config = mailServerConfig(agentDir, script);
    args.upsertServer(agentDir, MAIL_SERVER_NAME, config);
    const activated = args.activateMcpServer(MAIL_SERVER_NAME, config);

    sendToRenderer("connectors.statusChanged");
    return activated ? { ok: true } : { ok: true, pendingActivation: true };
  });

  ipcMain.handle("mail.testAccount", async (_e, email: string) => {
    const account = readMailAccounts(agentDir)[email];
    if (!account) return { ok: false, error: `unknown mailbox: ${email}` };
    const result = await testMailAccount(
      { imap: account.imap, smtp: account.smtp },
      account.credential,
    );
    setMailAccountCheck(agentDir, email, {
      ok: result.ok,
      ...(result.ok ? {} : { message: result.message }),
      at: Date.now(),
    });
    sendToRenderer("connectors.statusChanged");
    return result.ok ? { ok: true } : { ok: false, error: result.message };
  });

  ipcMain.handle(
    "mail.updateCredential",
    async (_e, email: string, credential: string) => {
      const account = readMailAccounts(agentDir)[email];
      if (!account) return { ok: false, error: `unknown mailbox: ${email}` };
      const result = await testMailAccount(
        { imap: account.imap, smtp: account.smtp },
        credential,
      );
      if (!result.ok) {
        // 失败时不动旧值 —— 用户手里的旧授权码可能还有效
        return { ok: false, error: result.message };
      }
      upsertMailAccount(agentDir, email, {
        ...account,
        credential,
        lastCheck: { ok: true, at: Date.now() },
      });
      sendToRenderer("connectors.statusChanged");
      return { ok: true };
    },
  );

  ipcMain.handle("mail.removeAccount", (_e, email: string) => {
    const removed = removeMailAccount(agentDir, email);
    if (!removed) return { ok: false, error: `unknown mailbox: ${email}` };
    // 删掉最后一个邮箱后要清掉 mcp.json 里的 Mail 条目 ——
    // 否则留下一个永远连不上的空 server（`retired-presets.ts` 处理过的那类残留）
    if (Object.keys(readMailAccounts(agentDir)).length === 0) {
      args.removeServer(agentDir, MAIL_SERVER_NAME);
    }
    sendToRenderer("connectors.statusChanged");
    return { ok: true };
  });
}
