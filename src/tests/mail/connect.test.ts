import { describe, it, expect } from "vitest";
import {
  connectAndTest,
  resolveEndpointInput,
  testMailAccount,
} from "../../main/mail/connect";
import type { MailAccountEndpoint } from "../../shared/mail-accounts";

describe("resolveEndpointInput", () => {
  it("takes host/port/secure straight from the preset", () => {
    const out = resolveEndpointInput({
      providerId: "qq",
      email: "zhangsan@qq.com",
      credential: "x",
    });
    expect(out.imap).toEqual({
      host: "imap.qq.com",
      port: 993,
      secure: true,
      user: "zhangsan@qq.com",
    });
    expect(out.smtp).toEqual({
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      user: "zhangsan@qq.com",
    });
  });

  it("keeps the iCloud IMAP username as the full address on the first attempt", () => {
    const out = resolveEndpointInput({
      providerId: "icloud",
      email: "me@icloud.com",
      credential: "x",
    });
    expect(out.imap.user).toBe("me@icloud.com");
    expect(out.smtp.user).toBe("me@icloud.com");
    expect(out.smtp.secure).toBe(false); // 587 STARTTLS
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      resolveEndpointInput({
        providerId: "nope" as never,
        email: "a@b.com",
        credential: "x",
      }),
    ).toThrow(/unknown provider/i);
  });

  it("requires hosts for the custom provider", () => {
    expect(() =>
      resolveEndpointInput({
        providerId: "custom",
        email: "a@b.com",
        credential: "x",
      }),
    ).toThrow(/custom/i);
    expect(
      resolveEndpointInput({
        providerId: "custom",
        email: "a@b.com",
        credential: "x",
        imapHost: "imap.b.com",
        imapPort: 993,
        smtpHost: "smtp.b.com",
        smtpPort: 465,
      }).imap.host,
    ).toBe("imap.b.com");
  });

  it("rejects a blank credential", () => {
    expect(() =>
      resolveEndpointInput({
        providerId: "qq",
        email: "a@qq.com",
        credential: "   ",
      }),
    ).toThrow(/credential/i);
  });
});

describe("testMailAccount", () => {
  it("returns ok:false with a readable message when the host does not resolve", async () => {
    const result = await testMailAccount(
      {
        imap: { host: "imap.invalid", port: 993, secure: true, user: "a@b.com" },
        smtp: { host: "smtp.invalid", port: 465, secure: true, user: "a@b.com" },
      },
      "x",
      500,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("connectAndTest", () => {
  it("retries with the local part for iCloud and keeps SMTP on the full address", async () => {
    const attempts: string[] = [];
    const tester = async (e: {
      imap: MailAccountEndpoint;
    }): Promise<{ ok: true } | { ok: false; message: string }> => {
      attempts.push(e.imap.user);
      return e.imap.user === "me"
        ? { ok: true }
        : { ok: false, message: "Authentication failed" };
    };
    const result = await connectAndTest(
      { providerId: "icloud", email: "me@icloud.com", credential: "x" },
      tester,
    );
    expect(attempts).toEqual(["me@icloud.com", "me"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.imap.user).toBe("me");
      expect(result.smtp.user).toBe("me@icloud.com");
    }
  });

  it("does not retry for providers without the flag — one attempt only", async () => {
    const attempts: string[] = [];
    const tester = async (e: {
      imap: MailAccountEndpoint;
    }): Promise<{ ok: false; message: string }> => {
      attempts.push(e.imap.user);
      return { ok: false, message: "nope" };
    };
    const result = await connectAndTest(
      { providerId: "qq", email: "a@qq.com", credential: "x" },
      tester,
    );
    expect(attempts).toEqual(["a@qq.com"]);
    expect(result.ok).toBe(false);
  });

  it("reports the first attempt's message when both fail", async () => {
    const tester = async (e: {
      imap: MailAccountEndpoint;
    }): Promise<{ ok: false; message: string }> => ({
      ok: false,
      message: e.imap.user === "me@icloud.com" ? "first error" : "second error",
    });
    const result = await connectAndTest(
      { providerId: "icloud", email: "me@icloud.com", credential: "x" },
      tester,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("first error");
  });
});
