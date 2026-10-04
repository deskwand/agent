/**
 * Vendored from https://github.com/samihalawa/email-smtp-imap-mcp
 * at v2.2.0 (commit 6b9610d0c74450e938aa0428d08dbdefa02f4b7f), MIT licensed. See ./LICENSE.
 * Local changes are marked with `[DeskWand]`.
 */

/**
 * Type definitions for the email MCP server
 */

export interface EmailAccount {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  imap_user: string;
  imap_pass: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  default_from_name?: string;
  sender_emails?: string[];
}

export interface EmailAccounts {
  [accountName: string]: EmailAccount;
}

export interface EmailFilters {
  from?: string;
  to?: string;
  subject?: string;
  has_attachments?: boolean;
  is_unread?: boolean;
  is_flagged?: boolean;
  after_date?: string;
  before_date?: string;
}

export interface EmailAttachment {
  filename: string;
  /**
   * [DeskWand] Base64 内容 —— **仅发送方向**（email_send / email_respond 重挂原件）。
   * 读取方向（emails_find）只有元数据，永不内联正文（设计 §3.4）。
   */
  content?: string; // Base64 encoded
  content_type?: string;
  /** [DeskWand] 读取方向的字节数（元数据，来自 bodyStructure）。 */
  size?: number;
}

export interface EmailMessage {
  id: string;
  thread_id?: string;
  message_id?: string;
  subject: string;
  from: string;
  reply_to?: string;
  to: string[];
  cc?: string[];
  date: string;
  snippet?: string;
  body?: string;
  is_unread: boolean;
  is_flagged: boolean;
  has_attachments: boolean;
  attachments?: EmailAttachment[];
  /** [DeskWand] 该封超过解析上限时置为 'too large'（设计 §3.4 尺寸护栏）。 */
  content_skipped?: string;
}

export interface EmailFolder {
  name: string;
  path: string;
  unread_count?: number;
  total_count?: number;
}
