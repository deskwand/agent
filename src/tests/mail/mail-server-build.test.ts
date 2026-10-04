import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  mailAttachmentsDir,
  mailServerConfig,
} from "../../main/mail/mail-server-config";
import { mailAccountsPath } from "../../main/mail/account-store";

describe("mail server config", () => {
  it("declares a single stdio server named Mail", () => {
    const config = mailServerConfig("/tmp/agent", "/tmp/main/dist-mcp/mail-server.js");
    expect(config).toEqual({
      type: "stdio",
      command: "node",
      args: ["/tmp/main/dist-mcp/mail-server.js"],
      env: {
        DESKWAND_MAIL_ACCOUNTS_FILE: path.join("/tmp/agent", "mail-accounts.json"),
        DESKWAND_MAIL_ATTACHMENTS_DIR: path.join("/tmp/agent", "mail-attachments"),
      },
    });
  });

  it("derives both paths from agentDir so they follow the user data dir", () => {
    expect(mailAttachmentsDir("/a/b")).toBe(
      path.join("/a/b", "mail-attachments"),
    );
  });

  it("points the server at the SAME accounts file the store writes to", () => {
    // 这条守的是一个静默分歧：配置里曾经自己拼了一份路径，与账号存储那份重复。
    // 两处分开写的话，只改一处就会出现「邮箱加成功了，但 server 说没有账号配置」。
    // 断言两者相等，而不是重写一遍字面量 —— 重写一遍就等于把 bug 写进测试。
    const config = mailServerConfig("/a/b", "/x.js") as unknown as {
      env: Record<string, string>;
    };
    expect(config.env.DESKWAND_MAIL_ACCOUNTS_FILE).toBe(mailAccountsPath("/a/b"));
  });
});

describe("bundle registration", () => {
  it("lists mail-server in the esbuild bundle targets", () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), "scripts/bundle-mcp.js"),
      "utf8",
    );
    expect(script).toContain("mail-server");
  });
});
