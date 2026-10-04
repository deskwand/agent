/**
 * Vendored from https://github.com/samihalawa/email-smtp-imap-mcp
 * at v2.2.0 (commit 6b9610d0c74450e938aa0428d08dbdefa02f4b7f), MIT licensed. See ./LICENSE.
 * Local changes are marked with `[DeskWand]`.
 *
 * [DeskWand] 整个 loadAccounts 被重写：vendor 从 `EMAIL_ACCOUNTS_JSON` 环境变量读，
 * 改成读 `DESKWAND_MAIL_ACCOUNTS_FILE` 指向的文件（主进程在 spawn 时注入，
 * 内容是 `<agentDir>/mail-accounts.json`）。
 *
 * 为什么是文件而不是 env：账号要能在应用里加/删，而 env 是 spawn 时固定的 ——
 * 走 env 的话每加一个邮箱都要重启 MCP 子进程。getAccount() 本来每次工具调用都
 * 重新 load（见下），所以换成文件之后连重启都不需要。
 *
 * normalizeAccountConfig / validateAccount 原样保留 —— 它们本来就读嵌套的
 * `cfg.imap.{host,port,secure,user}`，我们只需把 credential 映射成它期望的 password。
 */
import * as fs from "node:fs";
import type { EmailAccounts, EmailAccount } from "./types";

function firstDefined(...values: Array<string | undefined>): string {
  return values.find((value) => value !== undefined && value !== "") || "";
}

function parsePort(
  value: unknown,
  fallback: number,
  fieldName: string,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${fieldName} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function toBoolean(
  value: unknown,
  fallback: boolean,
  fieldName: string,
): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${fieldName} must be true or false`);
}

function parseSenderEmails(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((email) => email.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
  }
  return undefined;
}

function normalizeAccountConfig(accountName: string, cfg: any): EmailAccount {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    throw new Error(`Account "${accountName}" must be an object`);
  }

  const smtp = cfg.smtp || {};
  const imap = cfg.imap || {};

  const smtpUser = firstDefined(
    smtp.user,
    cfg.smtp_user,
    cfg.SMTP_USER,
    cfg.SMTP_USERNAME,
  );
  const smtpPass = firstDefined(
    smtp.password,
    smtp.pass,
    cfg.smtp_pass,
    cfg.SMTP_PASS,
    cfg.SMTP_PASSWORD,
  );
  const imapUser = firstDefined(
    imap.user,
    imap.username,
    cfg.imap_user,
    cfg.IMAP_USER,
    cfg.IMAP_USERNAME,
    smtpUser,
  );
  const imapPass = firstDefined(
    imap.password,
    imap.pass,
    cfg.imap_pass,
    cfg.IMAP_PASS,
    cfg.IMAP_PASSWORD,
    smtpPass,
  );

  return {
    smtp_host: firstDefined(
      smtp.host,
      cfg.smtp_host,
      cfg.SMTP_HOST,
      cfg.SMTP_SERVER,
      cfg.MTP_SERVER,
    ),
    smtp_port: parsePort(
      smtp.port ?? cfg.smtp_port ?? cfg.SMTP_PORT,
      587,
      `Account "${accountName}" SMTP port`,
    ),
    smtp_secure: toBoolean(
      smtp.secure ?? cfg.smtp_secure ?? cfg.SMTP_SECURE,
      parsePort(
        smtp.port ?? cfg.smtp_port ?? cfg.SMTP_PORT,
        587,
        `Account "${accountName}" SMTP port`,
      ) === 465,
      `Account "${accountName}" SMTP secure`,
    ),
    smtp_user: smtpUser,
    smtp_pass: smtpPass,
    imap_user: imapUser,
    imap_pass: imapPass,
    imap_host: firstDefined(
      imap.host,
      cfg.imap_host,
      cfg.IMAP_HOST,
      cfg.IMAP_SERVER,
    ),
    imap_port: parsePort(
      imap.port ?? cfg.imap_port ?? cfg.IMAP_PORT,
      993,
      `Account "${accountName}" IMAP port`,
    ),
    imap_secure: toBoolean(
      imap.secure ?? cfg.imap_secure ?? cfg.IMAP_SECURE,
      parsePort(
        imap.port ?? cfg.imap_port ?? cfg.IMAP_PORT,
        993,
        `Account "${accountName}" IMAP port`,
      ) === 993,
      `Account "${accountName}" IMAP secure`,
    ),
    default_from_name: cfg.default_from_name || cfg.DEFAULT_FROM_NAME,
    sender_emails: parseSenderEmails(cfg.sender_emails ?? cfg.SENDER_EMAILS),
  };
}

function validateAccount(accountName: string, account: EmailAccount): void {
  const missingFields: string[] = [];
  if (!account.smtp_host) missingFields.push("smtp.host");
  if (!account.smtp_user) missingFields.push("smtp.user");
  if (!account.smtp_pass) missingFields.push("smtp.password");
  if (!account.imap_host) missingFields.push("imap.host");
  if (!account.imap_user) missingFields.push("imap.user");
  if (!account.imap_pass) missingFields.push("imap.password");
  if (missingFields.length > 0) {
    throw new Error(
      `Account "${accountName}" is missing required fields: ${missingFields.join(", ")}`,
    );
  }
}

/** [DeskWand] 账号文件路径。主进程在 spawn 时通过 env 注入。 */
function accountsFilePath(): string {
  const file = process.env.DESKWAND_MAIL_ACCOUNTS_FILE;
  if (!file) {
    throw new Error(
      "DESKWAND_MAIL_ACCOUNTS_FILE is not set. The Mail server must be started by DeskWand.",
    );
  }
  return file;
}

function readAccountsFile(): Record<string, unknown> {
  const file = accountsFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to read ${file}: ${(error as Error).message}`);
  }
}

/**
 * [DeskWand] 账号文件里凭据叫 `credential`（一个值同时用于 IMAP 与 SMTP），
 * 而 vendor 的 normalizer 找的是 `imap.password` / `smtp.password` —— 在这里映射。
 */
export function loadAccounts(): EmailAccounts {
  const raw = readAccountsFile();
  const accounts: EmailAccounts = {};
  for (const [accountName, value] of Object.entries(raw)) {
    const cfg = (value ?? {}) as Record<string, any>;
    const imap = { ...(cfg.imap ?? {}), password: cfg.credential };
    const smtp = { ...(cfg.smtp ?? {}), password: cfg.credential };
    const account = normalizeAccountConfig(accountName, { imap, smtp });
    validateAccount(accountName, account);
    accounts[accountName] = account;
  }
  return accounts;
}

/**
 * Get a specific email account by name
 */
export function getAccount(accountName?: string): {
  name: string;
  config: EmailAccount;
} {
  if (
    accountName !== undefined &&
    (typeof accountName !== "string" || accountName.trim() === "")
  ) {
    throw new Error("account_name must be a non-empty string");
  }
  const accounts = loadAccounts();

  // If no account name specified, use the default
  if (!accountName) {
    const defaultAccountName =
      process.env.DEFAULT_EMAIL_ACCOUNT || Object.keys(accounts)[0];
    if (!defaultAccountName) {
      throw new Error("No email accounts configured");
    }
    accountName = defaultAccountName;
  }

  const config = accounts[accountName];
  if (!config) {
    const availableAccounts = Object.keys(accounts).join(", ");
    throw new Error(
      `Account "${accountName}" not found. Available accounts: ${availableAccounts}`,
    );
  }

  return { name: accountName, config };
}

/**
 * List all configured accounts
 */
export function listAccounts(): string[] {
  const accounts = loadAccounts();
  return Object.keys(accounts);
}
