import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  mailAccountsPath,
  readMailAccounts,
  removeMailAccount,
  setMailAccountCheck,
  upsertMailAccount,
} from "../../main/mail/account-store";
import { toAccountView, type MailAccount } from "../../shared/mail-accounts";

let agentDir: string;

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-accounts-"));
});

function sampleAccount(email: string): MailAccount {
  const local = email.split("@")[0];
  return {
    providerId: "qq",
    credential: "abcd1234efgh5678",
    imap: { host: "imap.qq.com", port: 993, secure: true, user: email },
    smtp: { host: "smtp.qq.com", port: 465, secure: true, user: local },
  };
}

describe("mail account store", () => {
  it("returns an empty object when the file does not exist", () => {
    expect(readMailAccounts(agentDir)).toEqual({});
  });

  it("round-trips an account keyed by email address", () => {
    upsertMailAccount(
      agentDir,
      "zhangsan@qq.com",
      sampleAccount("zhangsan@qq.com"),
    );
    const back = readMailAccounts(agentDir);
    expect(Object.keys(back)).toEqual(["zhangsan@qq.com"]);
    expect(back["zhangsan@qq.com"]).toEqual(sampleAccount("zhangsan@qq.com"));
  });

  it("creates the file with 0600 permissions", () => {
    upsertMailAccount(
      agentDir,
      "zhangsan@qq.com",
      sampleAccount("zhangsan@qq.com"),
    );
    const mode = fs.statSync(mailAccountsPath(agentDir)).mode & 0o777;
    // Windows 上 chmod 是 no-op，fs.statSync 会给出 0o666 —— 只在类 Unix 上断言。
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
  });

  it("keeps several accounts independent", () => {
    upsertMailAccount(agentDir, "a@qq.com", sampleAccount("a@qq.com"));
    upsertMailAccount(agentDir, "b@gmail.com", {
      ...sampleAccount("b@gmail.com"),
      providerId: "gmail",
    });
    expect(Object.keys(readMailAccounts(agentDir)).sort()).toEqual([
      "a@qq.com",
      "b@gmail.com",
    ]);
  });

  it("replaces an existing account rather than duplicating it", () => {
    upsertMailAccount(agentDir, "a@qq.com", sampleAccount("a@qq.com"));
    upsertMailAccount(agentDir, "a@qq.com", {
      ...sampleAccount("a@qq.com"),
      credential: "newcode000000000",
    });
    const back = readMailAccounts(agentDir);
    expect(Object.keys(back)).toHaveLength(1);
    expect(back["a@qq.com"].credential).toBe("newcode000000000");
  });

  it("removes an account and reports whether it existed", () => {
    upsertMailAccount(agentDir, "a@qq.com", sampleAccount("a@qq.com"));
    expect(removeMailAccount(agentDir, "a@qq.com")).toBe(true);
    expect(removeMailAccount(agentDir, "a@qq.com")).toBe(false);
    expect(readMailAccounts(agentDir)).toEqual({});
  });

  it("records the last connectivity check without touching the credential", () => {
    upsertMailAccount(agentDir, "a@qq.com", sampleAccount("a@qq.com"));
    expect(
      setMailAccountCheck(agentDir, "a@qq.com", {
        ok: false,
        message: "Authentication failed",
        at: 1_700_000_000_000,
      }),
    ).toBe(true);
    const back = readMailAccounts(agentDir)["a@qq.com"];
    expect(back.lastCheck).toEqual({
      ok: false,
      message: "Authentication failed",
      at: 1_700_000_000_000,
    });
    expect(back.credential).toBe("abcd1234efgh5678");
  });

  it("refuses to record a check for an unknown account", () => {
    expect(
      setMailAccountCheck(agentDir, "nope@qq.com", { ok: true, at: 1 }),
    ).toBe(false);
  });

  it("never leaks the credential through the renderer DTO", () => {
    const account = sampleAccount("a@qq.com");
    const view = toAccountView("a@qq.com", account);
    expect(view).toEqual({
      email: "a@qq.com",
      providerId: "qq",
      lastCheck: undefined,
    });
    expect(JSON.stringify(view)).not.toContain("abcd1234efgh5678");
  });
});
