import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveEndpointInput, testMailAccount } from "../../main/mail/connect";
import { searchEmails } from "../../main/mcp/mail/imap-service";
import { loadAccounts } from "../../main/mcp/mail/account-store";
import { findMailProvider } from "../../shared/mail-providers";
import type { MailProviderId } from "../../shared/mail-providers";

/**
 * 真连测试。**默认跳过** —— 需要 `DESKWAND_MAIL_LIVE=1` 加上真凭据才跑。
 *
 * 它是发版前的必跑项，不是加分项：8 行预设里只有 5 家到过协议层探针
 * （CAPABILITY / RFC 2971 ID 的应答），另外 3 家连协议层都没测过。
 * 这是唯一能发现「某个预设的主机/端口/加密写错了」的地方。
 *
 * 跑法：
 *   MAIL_LIVE_QQ_EMAIL=you@qq.com MAIL_LIVE_QQ_CODE=<16位授权码> \
 *   MAIL_LIVE_QQ_SUMMARY=1 npm run verify:mail
 * 也支持 MAIL_LIVE_IMAP_* / MAIL_LIVE_SMTP_* 走自定义服务商。
 */
const LIVE = process.env.DESKWAND_MAIL_LIVE === "1";

/** 每个服务商一个前缀：MAIL_LIVE_<PROVIDER>_EMAIL / _CODE。 */
const PROVIDERS: MailProviderId[] = [
  "qq",
  "netease-163",
  "netease-126",
  "exmail",
  "aliyun",
  "gmail",
  "icloud",
];

interface LiveCase {
  providerId: MailProviderId;
  email: string;
  credential: string;
}

/** 只有把邮箱与凭据都配上环境变量的服务商才会被跑到。 */
function configuredCases(): LiveCase[] {
  const cases: LiveCase[] = [];
  for (const providerId of PROVIDERS) {
    const key = providerId.toUpperCase().replace(/-/g, "_");
    const email = process.env[`MAIL_LIVE_${key}_EMAIL`];
    const credential = process.env[`MAIL_LIVE_${key}_CODE`];
    if (email && credential) cases.push({ providerId, email, credential });
  }
  return cases;
}

describe.skipIf(!LIVE)("live mailbox connectivity", () => {
  const cases = configuredCases();

  it("has at least one mailbox configured", () => {
    // 开着 LIVE 却一个都没配 ⇒ 这轮什么都没验到，必须显式失败而不是静默通过
    expect(
      cases.length,
      "set MAIL_LIVE_<PROVIDER>_EMAIL and MAIL_LIVE_<PROVIDER>_CODE for at least one provider",
    ).toBeGreaterThan(0);
  });

  it.each(configuredCases().map((c) => [c.providerId, c] as const))(
    "%s: connects over IMAP and authenticates over SMTP",
    async (_providerId, live) => {
      const endpoints = resolveEndpointInput({
        providerId: live.providerId,
        email: live.email,
        credential: live.credential,
      });
      const result = await testMailAccount(endpoints, live.credential, 20_000);
      // 失败时把真实原因带出来 —— 这条测试的意义就是读出「预设写错了」
      expect(result.ok ? "" : result.message).toBe("");
    },
    30_000,
  );

  it.each(configuredCases().map((c) => [c.providerId, c] as const))(
    "%s: can list the inbox",
    async (_providerId, live) => {
      const endpoints = resolveEndpointInput({
        providerId: live.providerId,
        email: live.email,
        credential: live.credential,
      });
      // 走**生产同一条加载路径**：写临时账号文件 → 指环境变量 → loadAccounts()。
      // 这样测的就不只是 IMAP，还包括「账号文件能不能被 server 正确读出来」。
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-live-"));
      const file = path.join(dir, "mail-accounts.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          [live.email]: {
            providerId: live.providerId,
            credential: live.credential,
            imap: endpoints.imap,
            smtp: endpoints.smtp,
          },
        }),
      );
      process.env.DESKWAND_MAIL_ACCOUNTS_FILE = file;
      const account = loadAccounts()[live.email];
      // 只取 1 封、不要正文 —— 这一条验的是连接与 SEARCH，不是邮箱大小
      const messages = await searchEmails(account, undefined, 1, false, false);
      expect(Array.isArray(messages)).toBe(true);
    },
    30_000,
  );

  it("every preset that is not custom has both endpoints", () => {
    // 纯数据检查，跟着真连测试一起跑，成本为零
    for (const providerId of PROVIDERS) {
      const preset = findMailProvider(providerId);
      expect(preset?.imap, providerId).toBeDefined();
      expect(preset?.smtp, providerId).toBeDefined();
    }
  });
});
