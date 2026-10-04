import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { AddMailAccountInput } from "../../../shared/mail-accounts";
import {
  MAIL_PROVIDERS,
  type MailProviderId,
} from "../../../shared/mail-providers";
import { useBrowserOcclusion } from "../../hooks/useBrowserOcclusion";
import { mailProviderIconUrl } from "./mail-provider-icons";

/**
 * 「添加邮箱」对话框。两屏：先选服务商，再填地址与凭据。
 *
 * 这一层守的是「**先测后写**」的外部表现（见设计 §3.7）：主进程在落盘前真的连一次，
 * 连不上就**什么都不写**。所以对话框必须让失败留在屏幕上 ——
 * 跳回第一屏或直接关闭，用户会以为加成了，随后在卡片上看到一条红字却不知道错在哪。
 */
export function MailAccountDialog({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 添加成功后调用 —— 由调用方刷新列表 */
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  useBrowserOcclusion(isOpen);
  /** null = 第一屏（还没选服务商）。 */
  const [providerId, setProviderId] = useState<MailProviderId | null>(null);
  const [email, setEmail] = useState("");
  const [credential, setCredential] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Esc 的处理注册在 effect 里，读状态要用 ref（否则闭包拿到旧的 busy）
  const busyRef = useRef(false);
  // onClose 也走 ref：调用方传的是内联箭头函数，每次父组件渲染都是新身份；
  // 放进下面那个「重置」effect 的依赖里会清掉用户正在填的内容。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // 只在**打开那一次**重置 —— 每次打开都从「选服务商」开始，
    // 留上一次的凭据会让人以为已经填过了。
    setProviderId(null);
    setEmail("");
    setCredential("");
    setImapHost("");
    setSmtpHost("");
    setError("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // busy 时不响应 Esc：请求已经在飞，关掉窗口会让「加成功了吗」变得不确定
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // 进第二屏后把光标放在邮箱地址上 —— 用户接下来就该填它
  useEffect(() => {
    if (isOpen && providerId) emailRef.current?.focus();
  }, [isOpen, providerId]);

  if (!isOpen) return null;

  const provider = MAIL_PROVIDERS.find((p) => p.id === providerId);
  // 空凭据写进配置会留下一个永远连不上、界面上却显示「已添加」的邮箱。
  const canSubmit = email.trim() !== "" && credential.trim() !== "";

  const submit = async () => {
    if (!provider || !canSubmit || busy) return;
    const trimmedEmail = email.trim();
    const trimmedCredential = credential.trim();
    if (provider.id === "custom" && (!imapHost.trim() || !smtpHost.trim())) {
      setError(t("mail.dialog.customHostsRequired"));
      return;
    }
    const input: AddMailAccountInput =
      provider.id === "custom"
        ? {
            providerId: provider.id,
            email: trimmedEmail,
            credential: trimmedCredential,
            imapHost: imapHost.trim(),
            smtpHost: smtpHost.trim(),
          }
        : {
            providerId: provider.id,
            email: trimmedEmail,
            credential: trimmedCredential,
          };
    setBusy(true);
    busyRef.current = true;
    setError("");
    try {
      const res = await window.electronAPI.mail.addAccount(input);
      if (!res.ok) {
        // 失败时留在第二屏、保留已填内容，用户改一个字符即可重试
        setError(
          withoutSecret(res.error ?? t("mail.dialog.failed"), trimmedCredential),
        );
        return;
      }
      onAdded();
      onClose();
    } catch (e) {
      // IPC 本身抛异常（不只是返回 ok:false）也要内联报错，不能静默
      setError(withoutSecret(String(e), trimmedCredential));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
      <div className="card w-full max-w-lg p-5 m-4 shadow-elevated animate-slide-up">
        {!provider ? (
          <>
            <p className="text-sm font-medium text-text-primary">
              {t("mail.dialog.title")}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {t("mail.dialog.providerHint")}
            </p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {MAIL_PROVIDERS.map((p) => {
                const iconUrl = mailProviderIconUrl(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`mail-provider-${p.id}`}
                    onClick={() => {
                      setProviderId(p.id);
                      setError("");
                    }}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border text-left hover:bg-surface-hover transition-colors"
                  >
                    {/* 有厂商图标就画图标（厂商只发布浅底版 logo，必须白底）；
                        没有的仍画预设表里的字母标记。 */}
                    <span
                      className={`w-7 h-7 flex-none flex items-center justify-center rounded-md ${
                        iconUrl
                          ? "bg-white border border-border"
                          : "bg-surface-hover text-[11px] font-semibold text-text-secondary"
                      }`}
                    >
                      {iconUrl ? (
                        <img src={iconUrl} alt="" className="w-5 h-5" />
                      ) : (
                        p.mark
                      )}
                    </span>
                    <span className="text-xs text-text-primary">
                      {t(p.nameKey)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="mail-back"
                aria-label={t("mail.dialog.back")}
                onClick={() => {
                  setProviderId(null);
                  setError("");
                }}
                className="-ml-1.5 rounded-lg p-1.5 transition-colors hover:bg-surface-hover"
              >
                <ArrowLeft className="h-4 w-4 text-text-secondary" />
              </button>
              <p className="text-sm font-medium text-text-primary">
                {t(provider.nameKey)}
              </p>
            </div>

            <label className="block text-xs text-text-muted mt-3">
              {t("mail.dialog.email")}
            </label>
            <input
              ref={emailRef}
              data-testid="mail-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="you@example.com"
              className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-surface font-mono text-xs text-text-primary"
            />

            <label className="block text-xs text-text-muted mt-3">
              {t(provider.credentialLabelKey)}
            </label>
            <input
              data-testid="mail-credential"
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy) void submit();
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("mail.dialog.credentialPlaceholder")}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-surface font-mono text-xs text-text-primary"
            />

            {/* 预设的主机与端口由服务商表提供，只有自定义才让用户填 ——
                端口刻意不暴露：写错的端口比主机名更难排查，而预设已经验证过。 */}
            {provider.id === "custom" && (
              <>
                <label className="block text-xs text-text-muted mt-3">
                  {t("mail.dialog.imapHost")}
                </label>
                <input
                  data-testid="mail-imap-host"
                  value={imapHost}
                  onChange={(event) => setImapHost(event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="imap.example.com"
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-surface font-mono text-xs text-text-primary"
                />
                <label className="block text-xs text-text-muted mt-3">
                  {t("mail.dialog.smtpHost")}
                </label>
                <input
                  data-testid="mail-smtp-host"
                  value={smtpHost}
                  onChange={(event) => setSmtpHost(event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="smtp.example.com"
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-surface font-mono text-xs text-text-primary"
                />
              </>
            )}

            <p className="text-[11px] text-text-muted mt-3">
              {t(provider.hintKey)}
              {provider.id !== "custom" && (
                <>
                  {" · "}
                  <a
                    href={provider.consoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {t("mail.dialog.consoleLink")}
                  </a>
                </>
              )}
            </p>

            {error && (
              <p role="alert" className="text-xs text-error mt-2">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-testid="mail-submit"
                disabled={!canSubmit || busy}
                onClick={() => void submit()}
                className="px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover text-sm font-medium transition-colors disabled:opacity-50"
              >
                {t("mail.dialog.submit")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 错误文案里不能出现用户刚填的凭据。
 *
 * 主进程自己回的消息不带凭据（`connect.ts` 的 `describeXxxFailure` 只回主机名），
 * 但 IPC 抛出的异常里可能带着底层库拼接的原文 —— 那是逐字回显凭据的地方。
 */
function withoutSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("***");
}
