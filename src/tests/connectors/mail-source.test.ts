import { describe, it, expect } from "vitest";
import { buildMailEntries } from "../../main/connectors/sources/mail-source";
import type { SourceBuildContext } from "../../main/connectors/sources/mcp-remote-source";

const ctx: SourceBuildContext = {
  loaded: { servers: [], errors: [] },
  statusFor: () => undefined,
  hasCredentials: () => false,
};

const account = (
  email: string,
  lastCheck?: { ok: boolean; message?: string; at: number },
) => ({
  email,
  providerId: "qq" as const,
  lastCheck,
});

describe("mail source", () => {
  it("produces one entry per account, all pointing at the single Mail server", () => {
    const entries = buildMailEntries(
      ctx,
      [account("a@qq.com"), account("b@qq.com")],
      true,
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.serverName).toBe("Mail");
      expect(entry.source).toBe("mail");
      expect(entry.transport).toBe("stdio");
      expect(entry.instances).toHaveLength(1);
    }
    expect(entries.map((e) => e.key)).toEqual(["mail:a@qq.com", "mail:b@qq.com"]);
  });

  it("never produces an empty-instance entry — a mailbox only exists once added", () => {
    expect(buildMailEntries(ctx, [], true)).toEqual([]);
  });

  it("maps lastCheck onto the four status branches", () => {
    const [never] = buildMailEntries(ctx, [account("a@qq.com")], true);
    expect(never.instances[0].status).toEqual({ kind: "idle" });

    const [ok] = buildMailEntries(
      ctx,
      [account("a@qq.com", { ok: true, at: 1 })],
      true,
    );
    expect(ok.instances[0].status).toEqual({ kind: "ready" });

    const [bad] = buildMailEntries(
      ctx,
      [account("a@qq.com", { ok: false, message: "Authentication failed", at: 1 })],
      true,
    );
    expect(bad.instances[0].status).toEqual({
      kind: "failed",
      message: "Authentication failed",
    });
  });

  it("reports off when the Mail server is not enabled in mcp.json", () => {
    const entries = buildMailEntries(
      ctx,
      [account("a@qq.com", { ok: true, at: 1 })],
      false,
    );
    expect(entries[0].instances[0].status).toEqual({ kind: "off" });
  });

  it("uses the provider mark as the avatar, not the email's first letter", () => {
    const [entry] = buildMailEntries(ctx, [account("zhangsan@qq.com")], true);
    expect(entry.avatarMark).toBe("QQ");
  });

  it("falls back to a neutral mark for an unknown provider id", () => {
    const [entry] = buildMailEntries(
      ctx,
      [{ email: "a@x.com", providerId: "nope" as never }],
      true,
    );
    expect(entry.avatarMark).toBe("＋");
  });

  it("carries the provider label as the description i18n key", () => {
    const [entry] = buildMailEntries(ctx, [account("a@qq.com")], true);
    expect(entry.descriptionKey).toBe("mail.provider.qq.name");
    // 名字用邮箱地址：t() 查不到 key 时原样返回，所以它不是 i18n key
    expect(entry.nameKey).toBe("a@qq.com");
    expect(entry.instances[0].label).toBe("a@qq.com");
  });
});
