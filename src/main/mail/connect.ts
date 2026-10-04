/**
 * 把表单输入变成落盘的账号，并在写盘前**真的连一次**。
 *
 * 为什么必须先测：邮箱的凭据种类多（授权码 / 应用专用密码 / 客户端专用密码），
 * 用户填错一个字符是常事。先写盘再报错会留下一个连不上的账号，卡片上永远一条红字，
 * 而用户以为「加过了」。
 */
import { t } from "../i18n";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type {
  AddMailAccountInput,
  MailAccountEndpoint,
} from "../../shared/mail-accounts";
import { findMailProvider } from "../../shared/mail-providers";

/** 与 `AddMailAccountInput` 同形；别处引 `ResolveInput` 的地方保持不动。 */
export type ResolveInput = AddMailAccountInput;

export function resolveEndpointInput(input: ResolveInput): {
  imap: MailAccountEndpoint;
  smtp: MailAccountEndpoint;
} {
  const { providerId, email, credential } = input;
  if (!credential.trim()) {
    throw new Error("credential must not be empty");
  }
  const provider = findMailProvider(providerId);
  if (!provider) {
    throw new Error(`unknown provider: ${providerId}`);
  }

  if (providerId === "custom") {
    if (!input.imapHost?.trim() || !input.smtpHost?.trim()) {
      throw new Error("custom provider requires imap and smtp hosts");
    }
    return {
      imap: {
        host: input.imapHost.trim(),
        port: input.imapPort ?? 993,
        secure: (input.imapPort ?? 993) === 993,
        user: email,
      },
      smtp: {
        host: input.smtpHost.trim(),
        port: input.smtpPort ?? 465,
        secure: (input.smtpPort ?? 465) === 465,
        user: email,
      },
    };
  }

  if (!provider.imap || !provider.smtp) {
    throw new Error(`provider ${providerId} has no preset endpoints`);
  }
  return {
    imap: { ...provider.imap, user: email },
    smtp: { ...provider.smtp, user: email },
  };
}

export type MailTestResult = { ok: true } | { ok: false; message: string };

/**
 * 真连一次：IMAP 登录 + SMTP 验证。
 * `timeoutMs` 在测试里调小，生产用默认。
 */
export async function testMailAccount(
  endpoints: { imap: MailAccountEndpoint; smtp: MailAccountEndpoint },
  credential: string,
  timeoutMs = 15_000,
): Promise<MailTestResult> {
  const imap = new ImapFlow({
    host: endpoints.imap.host,
    port: endpoints.imap.port,
    secure: endpoints.imap.secure,
    auth: { user: endpoints.imap.user, pass: credential },
    // 默认 clientInfo 会被 ImapFlow 按 CAPABILITY 门控发出 ——
    // 这正是 163/126 需要的 RFC 2971 ID，无需我们自己做
    logger: false,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });

  try {
    await imap.connect();
  } catch (error) {
    return { ok: false, message: describeImapFailure(error, endpoints.imap) };
  } finally {
    try {
      await imap.logout();
    } catch {
      /* 连接没建立起来时 logout 会抛，忽略 */
    }
  }

  const transport = nodemailer.createTransport({
    host: endpoints.smtp.host,
    port: endpoints.smtp.port,
    secure: endpoints.smtp.secure,
    auth: { user: endpoints.smtp.user, pass: credential },
    connectionTimeout: timeoutMs,
  });
  try {
    await transport.verify();
  } catch (error) {
    return { ok: false, message: describeSmtpFailure(error, endpoints.smtp) };
  } finally {
    transport.close();
  }

  return { ok: true };
}

function describeImapFailure(error: unknown, endpoint: MailAccountEndpoint): string {
  const text = String((error as Error)?.message ?? error);
  if (/Unsafe Login/i.test(text)) {
    // 163/126 专属：这是 CAPABILITY 里没有 ID 才会出现的分支，
    // 正常情况下走不到 —— 出现就说明 ImapFlow 的 clientInfo 没生效
    return t("mail.unsafeLogin");
  }
  if (/auth|credential|password|login/i.test(text)) {
    return t("mail.imapAuthFailed", { host: endpoint.host });
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(text)) {
    return t("mail.imapUnreachable", {
      host: endpoint.host,
      port: endpoint.port,
    });
  }
  if (/certificate|SSL|TLS/i.test(text)) {
    return t("mail.imapTlsFailed", { host: endpoint.host });
  }
  return text;
}

function describeSmtpFailure(error: unknown, endpoint: MailAccountEndpoint): string {
  const text = String((error as Error)?.message ?? error);
  if (/auth|credential|password|login|535/i.test(text)) {
    return t("mail.smtpAuthFailed", { host: endpoint.host });
  }
  return text;
}

export type ConnectAndTestResult =
  | { ok: true; imap: MailAccountEndpoint; smtp: MailAccountEndpoint }
  | { ok: false; message: string };

/**
 * 连接并测试，把 iCloud 的用户名分裂处理掉。
 *
 * Apple 声称 IMAP 用户名**通常**是地址 `@` 前的部分，而 SMTP 用户名必须是完整地址。
 * 写死任一个都会让一部分人「收得到、发不出」，所以：先试完整地址，失败且预设带
 * `tryLocalPartUser` 时换本地部分再试一次，**把通过的那一支落盘**。
 *
 * `tester` 可注入，让重试逻辑不联网也能测。
 */
export async function connectAndTest(
  input: ResolveInput,
  tester: (
    endpoints: { imap: MailAccountEndpoint; smtp: MailAccountEndpoint },
    credential: string,
  ) => Promise<MailTestResult> = testMailAccount,
): Promise<ConnectAndTestResult> {
  const endpoints = resolveEndpointInput(input);
  const first = await tester(endpoints, input.credential);
  if (first.ok) return { ok: true, imap: endpoints.imap, smtp: endpoints.smtp };

  const provider = findMailProvider(input.providerId);
  if (provider?.tryLocalPartUser !== true) {
    return { ok: false, message: first.message };
  }
  const localPart = input.email.split("@")[0];
  if (!localPart || localPart === input.email) {
    return { ok: false, message: first.message };
  }

  const retry = {
    imap: { ...endpoints.imap, user: localPart },
    // SMTP 用户名**保持完整地址** —— Apple 文档明确要求，不能跟着改
    smtp: endpoints.smtp,
  };
  const second = await tester(retry, input.credential);
  if (second.ok) return { ok: true, imap: retry.imap, smtp: retry.smtp };

  // 两次都失败时回**第一支的错误** —— 那是用户最可能填错的那个东西
  return { ok: false, message: first.message };
}
