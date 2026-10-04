import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * 这组测试防的是「改造后仍从 env 读」这类静默回退 —— 它不会报错，
 * 只会让用户加完邮箱后 Agent 一直说「没有配置任何账号」。
 */
const ORIGINAL_ENV = process.env.DESKWAND_MAIL_ACCOUNTS_FILE;

let agentDir: string;

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-server-config-"));
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined)
    delete process.env.DESKWAND_MAIL_ACCOUNTS_FILE;
  else process.env.DESKWAND_MAIL_ACCOUNTS_FILE = ORIGINAL_ENV;
  vi.resetModules();
});

function writeAccounts(accounts: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(agentDir, "mail-accounts.json"),
    JSON.stringify(accounts),
  );
  process.env.DESKWAND_MAIL_ACCOUNTS_FILE = path.join(
    agentDir,
    "mail-accounts.json",
  );
}

async function loadStore() {
  return import("../../main/mcp/mail/account-store");
}

describe("mail server account source", () => {
  it("reads accounts from DESKWAND_MAIL_ACCOUNTS_FILE", async () => {
    writeAccounts({
      "zhangsan@qq.com": {
        providerId: "qq",
        credential: "abcd1234efgh5678",
        imap: {
          host: "imap.qq.com",
          port: 993,
          secure: true,
          user: "zhangsan@qq.com",
        },
        smtp: {
          host: "smtp.qq.com",
          port: 465,
          secure: true,
          user: "zhangsan@qq.com",
        },
      },
    });
    const { loadAccounts } = await loadStore();
    const accounts = loadAccounts();
    expect(Object.keys(accounts)).toEqual(["zhangsan@qq.com"]);
    expect(accounts["zhangsan@qq.com"].imap_pass).toBe("abcd1234efgh5678");
    expect(accounts["zhangsan@qq.com"].smtp_pass).toBe("abcd1234efgh5678");
    expect(accounts["zhangsan@qq.com"].imap_host).toBe("imap.qq.com");
  });

  it("keeps the IMAP and SMTP usernames independent", async () => {
    // iCloud 的 IMAP 用户名可能是本地部分，SMTP 必须是完整地址
    writeAccounts({
      "me@icloud.com": {
        providerId: "icloud",
        credential: "abcd-efgh-ijkl-mnop",
        imap: { host: "imap.mail.me.com", port: 993, secure: true, user: "me" },
        smtp: {
          host: "smtp.mail.me.com",
          port: 587,
          secure: false,
          user: "me@icloud.com",
        },
      },
    });
    const { loadAccounts } = await loadStore();
    const a = loadAccounts()["me@icloud.com"];
    expect(a.imap_user).toBe("me");
    expect(a.smtp_user).toBe("me@icloud.com");
    expect(a.smtp_secure).toBe(false); // 587 必须是 STARTTLS，不能按端口推成 true
  });

  it("throws a clear error when the env var is missing", async () => {
    delete process.env.DESKWAND_MAIL_ACCOUNTS_FILE;
    const { loadAccounts } = await loadStore();
    expect(() => loadAccounts()).toThrow(/DESKWAND_MAIL_ACCOUNTS_FILE/);
  });

  it("treats a missing file as no accounts", async () => {
    process.env.DESKWAND_MAIL_ACCOUNTS_FILE = path.join(
      agentDir,
      "absent.json",
    );
    const { loadAccounts } = await loadStore();
    expect(loadAccounts()).toEqual({});
  });

  it("surfaces a malformed account instead of silently dropping it", async () => {
    writeAccounts({
      "a@qq.com": { providerId: "qq", credential: "", imap: {}, smtp: {} },
    });
    const { loadAccounts } = await loadStore();
    expect(() => loadAccounts()).toThrow(/a@qq\.com/);
  });

  it("has no dotenv dependency left in the module tree", async () => {
    writeAccounts({});
    const mod = await loadStore();
    expect(Object.keys(mod)).not.toContain("loadEnvironment");
  });
});
