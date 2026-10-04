/**
 * 邮箱账号的域模型。主进程与渲染层共用 —— **唯一类型来源**，不要在别处重复定义。
 *
 * 磁盘上的形状**以邮箱地址为键**：vendor 的 `EmailAccounts` 就是
 * `{ [accountName]: EmailAccount }`，而这个键正是工具参数 `account_name` 要传的值。
 * 用一个邮箱地址当键 → 用户认得出、天然唯一，且不需要再引入一个 id 概念到处翻译。
 */
import type { MailProviderId } from "./mail-providers";

export interface MailAccountEndpoint {
  host: string;
  port: number;
  /** true = 隐式 TLS（993 / 465）；false = STARTTLS（587） */
  secure: boolean;
  /** **解析后**的用户名。iCloud 可能是地址 `@` 前的部分，见设计 §3.8 */
  user: string;
}

export interface MailAccountCheck {
  ok: boolean;
  /** 失败原因。成功时省略 */
  message?: string;
  /** 毫秒时间戳 */
  at: number;
}

export interface MailAccount {
  providerId: MailProviderId;
  /** 授权码 / 应用专用密码。**只在主进程与 MCP 子进程之间流转，永不进渲染层** */
  credential: string;
  imap: MailAccountEndpoint;
  smtp: MailAccountEndpoint;
  /** 最近一次连通性测试的结果。卡片状态就靠它 —— 运行时的状态源只能给出 "connected" */
  lastCheck?: MailAccountCheck;
}

export type MailAccountsFile = Record<string, MailAccount>;

/** 给渲染层的形态 —— **没有 credential 字段**。 */
export interface MailAccountView {
  email: string;
  providerId: MailProviderId;
  lastCheck?: MailAccountCheck;
}

/**
 * 「添加邮箱」表单的输入。放在 shared 而不是 main —— 它跨 IPC 边界（渲染层提交、
 * 主进程消费），而 AGENTS.md §4 要求共享类型统一定义在 `src/shared/`。
 *
 * `imapHost` / `smtpHost` 等只对 `providerId: "custom"` 有意义；
 * 其余服务商的主机与端口由预设表提供（见 `mail-providers.ts`）。
 */
export interface AddMailAccountInput {
  providerId: MailProviderId;
  email: string;
  credential: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

/** 唯一的转换入口。手写 `{...account}` 会把凭据带出去。 */
export function toAccountView(
  email: string,
  account: MailAccount,
): MailAccountView {
  return {
    email,
    providerId: account.providerId,
    lastCheck: account.lastCheck,
  };
}
