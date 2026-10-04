/**
 * Vendored from https://github.com/samihalawa/email-smtp-imap-mcp
 * at v2.2.0 (commit 6b9610d0c74450e938aa0428d08dbdefa02f4b7f), MIT licensed. See ./LICENSE.
 * Local changes are marked with `[DeskWand]`.
 */

/**
 * IMAP email operations
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
// [DeskWand] relative imports drop the `.js` extension (repo style).
import type {
  EmailAccount,
  EmailAttachment,
  EmailFilters,
  EmailMessage,
  EmailFolder,
} from "./types";
// [DeskWand] 附件元数据走 bodyStructure，不为此抓整封 source（设计 §3.4）。
import { sanitizeAttachmentName } from "./attachment-path";
import { attachmentMetadataFromStructure, MAX_SOURCE_BYTES } from "./attachments";

/**
 * Create IMAP connection with timeout and error handling
 */
async function createImapConnection(account: EmailAccount): Promise<ImapFlow> {
  // Validate account configuration
  if (!account.imap_host) {
    throw new Error(
      "IMAP host not configured. Set IMAP_HOST or EMAIL_ACCOUNTS_JSON with imap.host",
    );
  }
  if (!account.imap_user) {
    throw new Error(
      "IMAP user not configured. Set IMAP_USER/IMAP_USERNAME or EMAIL_ACCOUNTS_JSON with imap.user",
    );
  }
  if (!account.imap_pass) {
    throw new Error(
      "IMAP password not configured. Set IMAP_PASS/IMAP_PASSWORD or EMAIL_ACCOUNTS_JSON with imap.password",
    );
  }

  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port || 993,
    secure: account.imap_secure !== false, // Default to true
    auth: {
      user: account.imap_user,
      pass: account.imap_pass,
    },
    logger: false, // Disable logging to avoid stdio issues
    connectionTimeout: 15000, // 15 second connection timeout
    greetingTimeout: 10000, // 10 second greeting timeout
    socketTimeout: 60000, // 60 second socket timeout for operations
  });

  // Handle errors to prevent unhandled exceptions
  // [DeskWand] `err` was unused in the vendored code; `_err` keeps the handler shape
  // and satisfies the repo's `no-unused-vars` gate.
  client.on("error", (_err: any) => {
    // Error will be caught by try/catch in calling functions
    // Don't use console.error as it may interfere with MCP stdio
  });

  try {
    await client.connect();
  } catch (error: any) {
    const message = error.message || String(error);
    if (message.includes("ECONNREFUSED")) {
      throw new Error(
        `Connection refused to ${account.imap_host}:${account.imap_port}. Check IMAP host/port settings.`,
      );
    }
    if (message.includes("ETIMEDOUT") || message.includes("timeout")) {
      throw new Error(
        `Connection timed out to ${account.imap_host}:${account.imap_port}. Check network/firewall.`,
      );
    }
    if (
      message.includes("certificate") ||
      message.includes("SSL") ||
      message.includes("TLS")
    ) {
      throw new Error(
        `SSL/TLS error connecting to ${account.imap_host}. Try setting imap_secure to ${!account.imap_secure}.`,
      );
    }
    if (
      message.includes("Invalid credentials") ||
      message.includes("authentication") ||
      message.includes("AUTH") ||
      message.includes("login")
    ) {
      throw new Error(
        `Authentication failed for ${account.imap_user}. Check username/password.`,
      );
    }
    throw new Error(`IMAP connection failed: ${message}`);
  }

  return client;
}

/**
 * Timeout wrapper for async operations
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // [DeskWand] vendor 漏了这一句：每个操作都留一个最长 90s 的挂起定时器。
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Build IMAP search criteria from filters
 */
export function buildSearchCriteria(
  filters?: EmailFilters,
  query?: string,
): any {
  if (!filters && !query) return { all: true };

  const criteria: any = {};

  if (filters?.from) criteria.from = filters.from;
  if (filters?.to) criteria.to = filters.to;
  if (filters?.subject) criteria.subject = filters.subject;
  if (filters?.is_unread === true) criteria.seen = false;
  if (filters?.is_unread === false) criteria.seen = true;
  if (filters?.is_flagged !== undefined) criteria.flagged = filters.is_flagged;
  if (filters?.after_date) criteria.since = new Date(filters.after_date);
  if (filters?.before_date) criteria.before = new Date(filters.before_date);
  if (query?.trim()) {
    const text = query.trim();
    criteria.or = [
      { subject: text },
      { body: text },
      { from: text },
      { to: text },
    ];
  }

  // If no criteria specified, search all
  if (Object.keys(criteria).length === 0) {
    return { all: true };
  }

  return criteria;
}

/**
 * Search for emails with timeout protection
 */
export async function searchEmails(
  account: EmailAccount,
  filters?: EmailFilters,
  limit: number = 20,
  includeContent: boolean = false,
  includeAttachments: boolean = false,
  query?: string,
): Promise<EmailMessage[]> {
  // Wrap entire operation with 90-second timeout (generous for large mailboxes)
  return withTimeout(
    searchEmailsInternal(
      account,
      filters,
      limit,
      includeContent,
      includeAttachments,
      query,
    ),
    90000,
    "Email search operation timed out after 90 seconds - try reducing limit or adding filters",
  );
}

/**
 * Internal search implementation
 */
async function searchEmailsInternal(
  account: EmailAccount,
  filters?: EmailFilters,
  limit: number = 20,
  includeContent: boolean = false,
  includeAttachments: boolean = false,
  query?: string,
): Promise<EmailMessage[]> {
  const client = await createImapConnection(account);

  try {
    // Open inbox with timeout
    const mailbox = await withTimeout(
      client.mailboxOpen("INBOX"),
      10000,
      "Mailbox open timed out",
    );

    // Build search criteria
    const searchCriteria = buildSearchCriteria(filters, query);

    // For efficiency: if no specific filters, fetch most recent messages by sequence number
    let messages: EmailMessage[] = [];

    if (
      searchCriteria.all === true &&
      filters?.has_attachments === undefined &&
      mailbox.exists > 0
    ) {
      // Fetch last N messages efficiently by sequence number (much faster)
      const start = Math.max(1, mailbox.exists - limit + 1);
      const end = mailbox.exists;

      for await (const message of client.fetch(`${start}:${end}`, {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        // [DeskWand] 附件元数据走 bodyStructure，不再为附件抓整封 source（设计 §3.4）。
        source: includeContent,
      })) {
        messages.push(
          await mapMessage(message, includeContent, includeAttachments),
        );
      }

      // Sort by date descending (newest first) and limit
      messages.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      messages = messages.slice(0, limit);
    } else {
      const foundUids = await client.search(searchCriteria, { uid: true });
      const pendingUids = foundUids ? [...foundUids].sort((a, b) => b - a) : [];
      const batchSize = Math.max(50, limit);

      while (pendingUids.length > 0 && messages.length < limit) {
        const batch = pendingUids.splice(0, batchSize);
        for await (const message of client.fetch(
          batch,
          {
            uid: true,
            flags: true,
            envelope: true,
            bodyStructure: true,
            // [DeskWand] 同上：只有需要正文时才抓 source。
            source: includeContent,
          },
          { uid: true },
        )) {
          const mapped = await mapMessage(
            message,
            includeContent,
            includeAttachments,
          );
          if (
            filters?.has_attachments === undefined ||
            mapped.has_attachments === filters.has_attachments
          ) {
            messages.push(mapped);
          }
        }
      }

      messages.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      messages = messages.slice(0, limit);
    }

    return messages;
  } finally {
    await client.logout();
  }
}

/**
 * Modify email flags
 *
 * [DeskWand] 当前无调用者（工具已移除）。保留以备恢复。
 */
export async function modifyEmails(
  account: EmailAccount,
  emailIds: string[],
  options: {
    markRead?: boolean;
    markUnread?: boolean;
    flag?: boolean;
    unflag?: boolean;
    moveToFolder?: string;
  },
): Promise<{ success: boolean; modified: number; errors?: string[] }> {
  const client = await createImapConnection(account);

  try {
    await client.mailboxOpen("INBOX");

    const errors: string[] = [];
    let modified = 0;

    for (const id of emailIds) {
      try {
        if (!/^\d+$/.test(id) || Number(id) < 1) {
          throw new Error("email ID must be a positive numeric UID");
        }
        const uid = parseInt(id);

        // Mark read/unread
        if (options.markRead) {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        }
        if (options.markUnread) {
          await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
        }

        // Flag/unflag
        if (options.flag) {
          await client.messageFlagsAdd(uid, ["\\Flagged"], { uid: true });
        }
        if (options.unflag) {
          await client.messageFlagsRemove(uid, ["\\Flagged"], { uid: true });
        }

        // Move to folder
        if (options.moveToFolder) {
          await client.messageMove(uid, options.moveToFolder, { uid: true });
        }

        modified++;
      } catch (error) {
        errors.push(`Failed to modify email ${id}: ${error}`);
      }
    }

    return {
      success: errors.length === 0,
      modified,
      errors: errors.length > 0 ? errors : undefined,
    };
  } finally {
    await client.logout();
  }
}

/**
 * List folders with timeout protection
 *
 * [DeskWand] 当前无调用者（工具已移除）。保留以备恢复。
 */
export async function listFolders(
  account: EmailAccount,
  includeCounts: boolean = false,
): Promise<EmailFolder[]> {
  // Wrap entire operation with 30-second timeout
  return withTimeout(
    listFoldersInternal(account, includeCounts),
    30000,
    "Folder list operation timed out after 30 seconds",
  );
}

/**
 * Internal list folders implementation
 */
async function listFoldersInternal(
  account: EmailAccount,
  includeCounts: boolean = false,
): Promise<EmailFolder[]> {
  let client: ImapFlow | null = null;

  try {
    client = await createImapConnection(account);
    const folders: EmailFolder[] = [];
    const mailboxList = await client.list();

    for (const mailbox of mailboxList) {
      const folder: EmailFolder = {
        name: mailbox.name,
        path: mailbox.path,
      };

      if (includeCounts) {
        try {
          const status = await client.status(mailbox.path, {
            messages: true,
            unseen: true,
          });
          // status() 同样可能返回 false（邮箱不存在/已被删除）。
          if (status !== false) {
            folder.total_count = status.messages;
            folder.unread_count = status.unseen;
          }
        } catch (error) {
          // If we can't get counts, just skip them
        }
      }

      folders.push(folder);
    }

    return folders;
  } catch (error: any) {
    // Re-throw with more context
    const message = error.message || String(error);
    if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
      throw new Error(
        `Cannot connect to IMAP server (${account.imap_host}:${account.imap_port}): ${message}`,
      );
    }
    if (
      message.includes("Invalid credentials") ||
      message.includes("authentication") ||
      message.includes("AUTH")
    ) {
      throw new Error(
        `IMAP authentication failed for ${account.imap_user}: ${message}`,
      );
    }
    throw new Error(`IMAP error: ${message}`);
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch (e) {
        // Ignore logout errors
      }
    }
  }
}

/**
 * Get a single email by ID
 */
export async function getEmailById(
  account: EmailAccount,
  emailId: string,
  includeAttachments: boolean = false,
): Promise<EmailMessage | null> {
  if (!/^\d+$/.test(emailId) || Number(emailId) < 1) {
    throw new Error(`Invalid email ID: ${emailId}`);
  }

  const client = await createImapConnection(account);
  try {
    return await fetchEmailByIdFromClient(client, emailId, includeAttachments);
  } finally {
    await client.logout();
  }
}

export async function fetchEmailByIdFromClient(
  client: Pick<ImapFlow, "mailboxOpen" | "fetchOne">,
  emailId: string,
  includeAttachments: boolean = false,
): Promise<EmailMessage | null> {
  await client.mailboxOpen("INBOX", { readOnly: true });
  const message = await client.fetchOne(
    emailId,
    {
      uid: true,
      flags: true,
      envelope: true,
      bodyStructure: true,
      source: true,
    },
    { uid: true },
  );

  // [DeskWand] 这是回复/转发的取件路径：重挂原件需要 base64 正文，
  // 它留在 server 进程内，不经过模型上下文。
  return message
    ? mapMessage(message, true, includeAttachments, includeAttachments)
    : null;
}

function structureHasAttachment(node: any): boolean {
  if (!node) return false;
  if (String(node.disposition || "").toLowerCase() === "attachment")
    return true;
  return (
    node.childNodes?.some((child: any) => structureHasAttachment(child)) ||
    false
  );
}

async function mapMessage(
  message: any,
  includeContent: boolean,
  includeAttachments: boolean,
  includeAttachmentBodies: boolean = false,
): Promise<EmailMessage> {
  let body: string | undefined;
  let attachments: EmailAttachment[] | undefined;
  let contentSkipped: string | undefined;

  const source: Buffer | undefined = message.source;
  // [DeskWand] 单封超限只标注跳过，不整批失败 —— 为了一封大信让另外 19 封都读不到是错的（设计 §3.4）。
  const oversized = Boolean(source && source.length > MAX_SOURCE_BYTES);

  if ((includeContent || includeAttachmentBodies) && source) {
    if (oversized) {
      if (includeAttachmentBodies) {
        // [DeskWand] 回复/转发必须解析原件才能重挂附件；明确报错，不要静默丢附件。
        throw new Error(
          `message is too large to parse (${source.length} bytes, limit ${MAX_SOURCE_BYTES})`,
        );
      }
      contentSkipped = "too large";
    } else {
      const parsed = await simpleParser(source);
      if (includeContent)
        body = parsed.html || parsed.textAsHtml || parsed.text || "";
      // [DeskWand] 仅回复/转发重挂原件时保留 base64；搜索路径永不内联（设计 §3.4）。
      if (
        includeAttachmentBodies &&
        includeAttachments &&
        parsed.attachments?.length
      ) {
        attachments = parsed.attachments.map((attachment: any) => ({
          filename: sanitizeAttachmentName(attachment.filename),
          content: attachment.content.toString("base64"),
          content_type: attachment.contentType,
        }));
      }
    }
  }

  // [DeskWand] 附件元数据从 bodyStructure 取，不需要 source；列表里不给 index ——
  // 结构遍历与 mailparser 的 attachments 数组顺序可能不同（设计 §3.4）。
  // 回复/转发路径（includeAttachmentBodies）只认解析出的原件，不拿元数据冒充正文。
  if (includeAttachments && !attachments && !includeAttachmentBodies) {
    const metadata = attachmentMetadataFromStructure(message.bodyStructure);
    if (metadata.length > 0) {
      attachments = metadata.map((item) => ({
        filename: item.filename,
        content_type: item.contentType,
        size: item.size,
      }));
    }
  }

  const formatAddress = (address: any): string =>
    address ? `${address.name || ""} <${address.address}>`.trim() : "Unknown";
  const envelope = message.envelope;

  return {
    id: message.uid.toString(),
    thread_id: message.threadId,
    message_id: envelope?.messageId,
    subject: envelope?.subject || "(No Subject)",
    from: formatAddress(envelope?.from?.[0]),
    reply_to: envelope?.replyTo?.[0]
      ? formatAddress(envelope.replyTo[0])
      : undefined,
    to: envelope?.to?.map(formatAddress) || [],
    cc: envelope?.cc?.map(formatAddress) || [],
    date: envelope?.date?.toISOString() || new Date().toISOString(),
    snippet: body ? body.substring(0, 200) : undefined,
    body,
    is_unread: !message.flags?.has("\\Seen"),
    is_flagged: message.flags?.has("\\Flagged") || false,
    has_attachments: structureHasAttachment(message.bodyStructure),
    attachments,
    content_skipped: contentSkipped,
  };
}

// [DeskWand] `emails_save_attachment` 的取件函数。放在文件尾部，尽量不扰动上面的 vendor 代码。

/** 取一封邮件的完整 RFC822 源码。附件落盘要的就是它。 */
export async function fetchRawSource(
  account: EmailAccount,
  emailId: string,
): Promise<Buffer> {
  // [DeskWand] 直接取 source。**不要**在这里再调一次 getEmailById ——
  // 它走 mapMessage，不回 source，白开一条连接多一次 round trip。
  const client = await createImapConnection(account);
  try {
    // [DeskWand] `ImapFlow.fetchOne()` 在没有打开任何 mailbox 时直接返回 undefined，
    // 少了这一步就会永远报 "no readable source"（node_modules/imapflow/dist/cjs/imap-flow.js）。
    await client.mailboxOpen("INBOX", { readOnly: true });
    const raw = await client.fetchOne(emailId, { source: true }, { uid: true });
    // imapflow 在无匹配时返回 `false`，不是 undefined；不先判别就无法收窄联合类型。
    if (raw === false || !raw?.source) {
      throw new Error(`email ${emailId} has no readable source`);
    }
    if (raw.source.length > MAX_SOURCE_BYTES) {
      throw new Error(
        `message is too large to parse (${raw.source.length} bytes, limit ${MAX_SOURCE_BYTES})`,
      );
    }
    return raw.source;
  } finally {
    await client.logout();
  }
}
