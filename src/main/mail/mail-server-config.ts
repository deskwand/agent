/**
 * `Mail` 这个 MCP server 的 spawn 配置。
 *
 * **server 名固定是 `Mail`** —— 工具名是 `mcp__Mail__<tool>`，改名会变更工具声明、
 * 破坏提示词缓存，并让老会话的工具调用记录对不上（AGENTS.md §5 明令）。
 * 所以名字不在这里拼，由调用方传字面量。
 */
import * as path from "node:path";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { mailAccountsPath } from "./account-store";

export function mailAttachmentsDir(agentDir: string): string {
  return path.join(agentDir, "mail-attachments");
}

export function mailServerConfig(
  agentDir: string,
  serverScriptPath: string,
): McpServerConfig {
  return {
    type: "stdio",
    command: "node",
    args: [serverScriptPath],
    env: {
      // **复用账号存储的那一个路径定义**，不在这里另写一份。
      // 两处各写一份的话，一旦只改一处，症状是「邮箱加成功了，但 server 说没有账号配置」——
      // 一个会浪费人半小时的静默分歧。
      DESKWAND_MAIL_ACCOUNTS_FILE: mailAccountsPath(agentDir),
      DESKWAND_MAIL_ATTACHMENTS_DIR: mailAttachmentsDir(agentDir),
    },
  };
}
