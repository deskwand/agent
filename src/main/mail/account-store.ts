/**
 * `<agentDir>/mail-accounts.json` 的读写。
 *
 * **不 import electron** —— 这一层要能被 vitest 直接测（vitest 把 electron
 * alias 到 tests/mocks/electron.ts，但这一层根本不需要它）。
 *
 * 写盘用「临时文件 + rename」：MCP 子进程每次工具调用都读这个文件，
 * 就地写会让它读到半截 JSON。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  MailAccount,
  MailAccountsFile,
  MailAccountCheck,
} from "../../shared/mail-accounts";

export function mailAccountsPath(agentDir: string): string {
  return path.join(agentDir, "mail-accounts.json");
}

export function readMailAccounts(agentDir: string): MailAccountsFile {
  const file = mailAccountsPath(agentDir);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as MailAccountsFile;
  } catch {
    // 坏 JSON 当成「没有账号」—— 抛出去会让连接页整页打不开，
    // 而用户此时最需要的正是能进页面把坏账号删掉。
    return {};
  }
}

function writeMailAccounts(agentDir: string, accounts: MailAccountsFile): void {
  const file = mailAccountsPath(agentDir);
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  // 0600：文件里有授权码
  fs.writeFileSync(temp, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function upsertMailAccount(
  agentDir: string,
  email: string,
  account: MailAccount,
): void {
  const accounts = readMailAccounts(agentDir);
  accounts[email] = account;
  writeMailAccounts(agentDir, accounts);
}

export function removeMailAccount(agentDir: string, email: string): boolean {
  const accounts = readMailAccounts(agentDir);
  if (!(email in accounts)) return false;
  delete accounts[email];
  writeMailAccounts(agentDir, accounts);
  return true;
}

export function setMailAccountCheck(
  agentDir: string,
  email: string,
  check: MailAccountCheck,
): boolean {
  const accounts = readMailAccounts(agentDir);
  const account = accounts[email];
  if (!account) return false;
  accounts[email] = { ...account, lastCheck: check };
  writeMailAccounts(agentDir, accounts);
  return true;
}
