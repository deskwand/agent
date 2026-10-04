/**
 * 邮箱来源：每个账号一张卡。
 *
 * **卡片动作是账号级的**，不是 server 级的 —— 所有邮箱条目共用 `serverName: "Mail"`，
 * 若照搬 `registry.removeServer(name)`，删一个邮箱会把整个 Mail server 删掉。
 * 分流由视图层做：邮箱卡片的两个动作各自走**账号级** IPC
 * （`ConnectorsView` 的 `onRemoveMailbox` / `onTestMailbox`），而不是按 server 名寻址。
 *
 * 邮箱条目**永不为空**（有账号才有条目），所以这里不产出「未添加」的引导卡 ——
 * 少一整个分支。
 */
import type { ConnectorEntry, ConnectorStatus } from "../../../shared/connectors";
import type { MailAccountView } from "../../../shared/mail-accounts";
import { findMailProvider } from "../../../shared/mail-providers";
import type { SourceBuildContext } from "./mcp-remote-source";

/** UI 副标题的 i18n key。**不要用 `connectors.summary.local`（那是「本机 stdio」）** ——
 *  贴在邮箱卡上是错的文案。 */
export const SERVER_SUMMARY_MAIL = "connectors.summary.mailbox";

/** 未知 providerId 时的兜底标记 —— 与预设表里 `custom` 的一致。 */
const FALLBACK_MARK = "＋";

function statusOf(
  account: MailAccountView,
  mailServerEnabled: boolean,
): ConnectorStatus {
  if (!mailServerEnabled) return { kind: "off" };
  const check = account.lastCheck;
  if (!check) return { kind: "idle" };
  if (check.ok) return { kind: "ready" };
  return { kind: "failed", message: check.message ?? "connection failed" };
}

export function buildMailEntries(
  _ctx: SourceBuildContext,
  accounts: readonly MailAccountView[],
  mailServerEnabled: boolean,
): ConnectorEntry[] {
  return accounts.map((account) => {
    const provider = findMailProvider(account.providerId);
    return {
      key: `mail:${account.email}`,
      serverName: "Mail",
      source: "mail" as const,
      transport: "stdio" as const,
      // 自定义条目没有 i18n key —— 直接用邮箱地址（t() 查不到时原样返回）
      nameKey: account.email,
      descriptionKey: provider?.nameKey,
      avatarMark: provider?.mark ?? FALLBACK_MARK,
      instances: [
        {
          id: account.email,
          label: account.email,
          status: statusOf(account, mailServerEnabled),
          summary: SERVER_SUMMARY_MAIL,
        },
      ],
    };
  });
}
