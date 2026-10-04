/**
 * Vendored from https://github.com/samihalawa/email-smtp-imap-mcp
 * at v2.2.0 (commit 6b9610d0c74450e938aa0428d08dbdefa02f4b7f), MIT licensed. See ./LICENSE.
 * Local changes are marked with `[DeskWand]`.
 */

/**
 * Tool request handlers for email operations
 */

// [DeskWand] relative imports drop the `.js` extension; `modifyEmails` / `listFolders`
// are gone because their tools (`emails_modify` / `folders_list`) were removed.
import { simpleParser } from "mailparser";
import { getAccount, loadAccounts } from "./account-store";
import { sanitizeAttachmentName } from "./attachment-path";
import { saveAttachmentFromSource } from "./attachments";
import { fetchRawSource, searchEmails } from "./imap-service";
import { sendEmail, replyToEmail, forwardEmail } from "./smtp-service";
import type { EmailFilters } from "./types";

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function requireStringArray(
  value: unknown,
  fieldName: string,
  allowEmpty = false,
): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(
      `${fieldName} is required and must be ${allowEmpty ? "an array of strings" : "a non-empty array of strings"}`,
    );
  }
  return value;
}

function validateOptionalStringArray(
  value: unknown,
  fieldName: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  return requireStringArray(value, fieldName, true);
}

function validateOptionalString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${fieldName} must be a non-empty string`);
  return value;
}

function validateOptionalBoolean(
  value: unknown,
  fieldName: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new Error(`${fieldName} must be a boolean`);
  return value;
}

function validateBodyType(value: unknown): "plain" | "html" {
  if (value === undefined) return "html";
  if (value !== "plain" && value !== "html")
    throw new Error("body_type must be plain or html");
  return value;
}

function validateAttachments(
  value: unknown,
  fieldName: string,
): any[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  for (const attachment of value) {
    if (
      !attachment ||
      typeof attachment !== "object" ||
      typeof attachment.filename !== "string" ||
      typeof attachment.content !== "string"
    ) {
      throw new Error(
        `${fieldName} entries require string filename and base64 content fields`,
      );
    }
  }
  return value;
}

export async function handleAccountsList(): Promise<string> {
  try {
    const accounts = loadAccounts();
    const accountNames = Object.keys(accounts);
    const defaultAccount = process.env.DEFAULT_EMAIL_ACCOUNT || accountNames[0];

    return JSON.stringify(
      {
        success: true,
        count: accountNames.length,
        default_account: defaultAccount,
        accounts: accountNames.map((name) => ({
          name,
          is_default: name === defaultAccount,
          smtp_configured: Boolean(accounts[name].smtp_host),
          imap_configured: Boolean(accounts[name].imap_host),
          sender_count: accounts[name].sender_emails?.length || 1,
        })),
      },
      null,
      2,
    );
  } catch (error: any) {
    return JSON.stringify(
      {
        success: false,
        error: error.message || "Failed to list accounts",
      },
      null,
      2,
    );
  }
}

/**
 * Handle emails_find tool
 */
export async function handleEmailsFind(args: any): Promise<string> {
  try {
    args = args || {};
    const { name, config } = getAccount(args.account_name);

    if (args.query !== undefined && typeof args.query !== "string")
      throw new Error("query must be a string");
    if (
      args.filters !== undefined &&
      (!args.filters ||
        typeof args.filters !== "object" ||
        Array.isArray(args.filters))
    ) {
      throw new Error("filters must be an object");
    }
    const filters: EmailFilters = args.filters || {};
    for (const stringField of ["from", "to", "subject"] as const) {
      validateOptionalString(filters[stringField], `filters.${stringField}`);
    }
    for (const booleanField of [
      "has_attachments",
      "is_unread",
      "is_flagged",
    ] as const) {
      validateOptionalBoolean(filters[booleanField], `filters.${booleanField}`);
    }
    for (const dateField of ["after_date", "before_date"] as const) {
      if (
        filters[dateField] !== undefined &&
        (typeof filters[dateField] !== "string" ||
          Number.isNaN(Date.parse(filters[dateField]!)))
      ) {
        throw new Error(`filters.${dateField} must be a valid date`);
      }
    }
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("limit must be an integer between 1 and 100");
    if (
      args.include_content !== undefined &&
      typeof args.include_content !== "boolean"
    )
      throw new Error("include_content must be a boolean");
    if (
      args.include_attachments !== undefined &&
      typeof args.include_attachments !== "boolean"
    )
      throw new Error("include_attachments must be a boolean");
    const includeContent = args.include_content ?? false;
    const includeAttachments = args.include_attachments ?? false;

    const emails = await searchEmails(
      config,
      filters,
      limit,
      includeContent,
      includeAttachments,
      args.query,
    );

    return JSON.stringify(
      {
        success: true,
        account: name,
        total_found: emails.length,
        count: emails.length,
        emails,
      },
      null,
      2,
    );
  } catch (error: any) {
    return JSON.stringify(
      {
        success: false,
        error: error.message || "Failed to search emails",
      },
      null,
      2,
    );
  }
}

/**
 * [DeskWand] `handleEmailsModify`（emails_modify）与 `handleFoldersList`（folders_list）
 * 连同工具一起删除。理由见 tools.ts 文件头。
 */

/**
 * Handle email_send tool
 */
export async function handleEmailSend(args: any): Promise<string> {
  try {
    args = args || {};
    const { name, config } = getAccount(args.account_name);

    const to = requireStringArray(args.to, "to");
    const subject = requireString(args.subject, "subject");
    const body = requireString(args.body, "body");
    const cc = validateOptionalStringArray(args.cc, "cc");
    const bcc = validateOptionalStringArray(args.bcc, "bcc");
    const attachments = validateAttachments(args.attachments, "attachments");
    const fromEmail = validateOptionalString(args.from_email, "from_email");

    const result = await sendEmail(config, {
      to,
      subject,
      body,
      bodyType: validateBodyType(args.body_type),
      cc,
      bcc,
      attachments,
      fromName: config.default_from_name,
      fromEmail,
    });

    return JSON.stringify(
      {
        success: result.success,
        account: name,
        message_id: result.messageId,
        to,
        subject,
      },
      null,
      2,
    );
  } catch (error: any) {
    return JSON.stringify(
      {
        success: false,
        error: error.message || "Failed to send email",
      },
      null,
      2,
    );
  }
}

/**
 * Handle email_respond tool
 */
export async function handleEmailRespond(args: any): Promise<string> {
  try {
    args = args || {};
    const { name, config } = getAccount(args.account_name);

    const emailId = requireString(args.email_id, "email_id");
    const body = requireString(args.body, "body");
    const to = validateOptionalStringArray(args.to, "to");
    const additionalAttachments = validateAttachments(
      args.additional_attachments,
      "additional_attachments",
    );
    validateOptionalBoolean(args.include_original, "include_original");
    validateOptionalBoolean(args.include_attachments, "include_attachments");

    const responseType = args.response_type || "reply";
    if (!["reply", "reply_all", "forward"].includes(responseType)) {
      throw new Error("response_type must be reply, reply_all, or forward");
    }

    let result;

    if (responseType === "forward") {
      if (!to?.length) throw new Error("to is required for forward");

      result = await forwardEmail(config, emailId, {
        to,
        body,
        bodyType: validateBodyType(args.body_type),
        includeOriginal: args.include_original !== false,
        includeAttachments: args.include_attachments !== false,
        additionalAttachments,
      });
    } else {
      result = await replyToEmail(config, emailId, {
        body,
        bodyType: validateBodyType(args.body_type),
        to,
        replyAll: responseType === "reply_all",
        includeOriginal: args.include_original !== false,
        includeAttachments: args.include_attachments !== false,
        additionalAttachments,
      });
    }

    return JSON.stringify(
      {
        success: result.success,
        account: name,
        message_id: result.messageId,
        response_type: responseType,
        original_email_id: emailId,
      },
      null,
      2,
    );
  } catch (error: any) {
    return JSON.stringify(
      {
        success: false,
        error: error.message || "Failed to respond to email",
      },
      null,
      2,
    );
  }
}

/** `index` 优先；没给 `index` 就按文件名找第一个匹配；两者都缺就报错。 */
async function resolveAttachmentIndex(
  args: { index?: unknown; filename?: unknown },
  source: Buffer,
): Promise<number> {
  if (typeof args.index === "number" && Number.isInteger(args.index)) {
    return args.index;
  }
  const wanted = typeof args.filename === "string" ? args.filename : undefined;
  if (!wanted) {
    throw new Error("either index or filename is required");
  }
  const parsed = await simpleParser(source);
  const index = (parsed.attachments ?? []).findIndex(
    (a: { filename?: string }) =>
      sanitizeAttachmentName(a.filename) === sanitizeAttachmentName(wanted),
  );
  if (index < 0) {
    throw new Error(`no attachment named ${wanted} on this message`);
  }
  return index;
}

/**
 * [DeskWand] `emails_save_attachment`：附件的唯一出口（设计 §3.4）。
 * 返回 JSON 字符串，与其它 handler 同形 —— 入口层会对返回值做 `JSON.parse`。
 */
export async function handleSaveAttachment(args: any): Promise<string> {
  try {
    args = args || {};
    const { name, config } = getAccount(args.account_name);
    const emailId = requireString(args.email_id, "email_id");
    // [DeskWand] 附件目录用**账号名**（就是邮箱地址），不是 `config.imap_user`。
    // iCloud 的 IMAP 用户名通常是地址 `@` 前的部分，于是 `me@icloud.com` 与
    // `me@me.com` 会落到**同一个** `me/` 目录里：两个邮箱的附件互相占名，
    // 第二封会被去重改成「报告 (2).pdf」。设计 §3.4 规定的是 `<邮箱地址>/`。
    const email = name;
    const root = process.env.DESKWAND_MAIL_ATTACHMENTS_DIR;
    if (!root) {
      throw new Error(
        "DESKWAND_MAIL_ATTACHMENTS_DIR is not set. The Mail server must be started by DeskWand.",
      );
    }
    const directory = validateOptionalString(args.directory, "directory");

    const source = await fetchRawSource(config, emailId);
    const saved = await saveAttachmentFromSource({
      source,
      root,
      email,
      index: await resolveAttachmentIndex(args, source),
      taken: new Set<string>(),
      subdir: directory,
    });

    return JSON.stringify(
      {
        success: true,
        account: name,
        email_id: emailId,
        ...saved,
      },
      null,
      2,
    );
  } catch (error: any) {
    return JSON.stringify(
      {
        success: false,
        error: error.message || "Failed to save attachment",
      },
      null,
      2,
    );
  }
}
