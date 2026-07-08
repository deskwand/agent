import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CloudApiClient } from "../services/cloud-api";
import { DESKWAND_API_URL } from "../../shared/oauth-config";
import type { CloudConfig } from "../types";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (config: CloudConfig) => void;
}

type LoginStep = "select" | "email" | "code";

export function LoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
}: LoginModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<LoginStep>("select");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setStep("email");
      setTimeout(() => emailRef.current?.focus(), 100);
      setEmail("");
      setCode("");
      setError(null);
      setCountdown(0);
    }
  }, [isOpen]);

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // ── 邮箱登录 ──

  const handleSendCode = async () => {
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError(t("auth.invalidEmail"));
      return;
    }
    setLoading(true);
    try {
      await new CloudApiClient().sendCode(email.trim());
      setStep("code");
      setCountdown(60);
      setTimeout(() => codeRef.current?.focus(), 100);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(
        err.code
          ? (t(`auth.errorCodes.${err.code}`, err.message ?? "") as string)
          : err.message || t("auth.sendFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError(null);
    if (code.length < 6) {
      setError(t("auth.invalidCode"));
      return;
    }
    setLoading(true);
    try {
      const result = await new CloudApiClient().login(
        email.trim(),
        code.trim(),
      );
      const cloudApi = new CloudApiClient(result.token);
      const config: CloudConfig = {
        serverUrl: DESKWAND_API_URL,
        token: result.token,
        isLoggedIn: true,
        email: result.user.email,
        level: result.user.level,
        creditsBalance: result.user.credits_balance,
        modes: [],
      };
      try {
        config.modes = await cloudApi.getModes();
      } catch {
        /* modes optional */
      }
      onLoginSuccess(config);
      onClose();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(
        err.code
          ? (t(`auth.errorCodes.${err.code}`, err.message ?? "") as string)
          : err.message || t("auth.loginFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-sm p-6 m-4 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-text-primary mb-5 text-center">
          {t("auth.loginTitle")}
        </h2>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-error/10 border border-error/20 text-xs text-error">
            {error}
          </div>
        )}

        {/* ── TODO: Google 登录入口（暂时隐藏，待 client_id 配置就绪后恢复） ── */}

        {/* ── 邮箱登录 ── */}
        {step === "email" ? (
          <>
            <div className="mb-4">
              <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendCode();
                }}
                placeholder={t("auth.emailPlaceholder")}
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg bg-surface-hover border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>
            <button
              onClick={handleSendCode}
              disabled={loading || !email.trim() || countdown > 0}
              className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-colors disabled:opacity-50 mb-2"
            >
              {loading
                ? t("auth.loading")
                : countdown > 0
                  ? `${countdown}s`
                  : t("auth.nextStep")}
            </button>
          </>
        ) : (
          <>
            <div className="mb-4 p-2.5 rounded-lg bg-success/10 border border-success/20 text-xs text-success">
              {t("auth.codeSent")} {email}
            </div>
            <div className="mb-4">
              <input
                ref={codeRef}
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  setCode(
                    e.clipboardData
                      .getData("text")
                      .replace(/\D/g, "")
                      .slice(0, 6),
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.length === 6) handleLogin();
                }}
                placeholder=""
                maxLength={6}
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg bg-surface-hover border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent disabled:opacity-50 text-center tracking-[0.5em]"
              />
            </div>
            <button
              onClick={handleLogin}
              disabled={loading || code.length < 6}
              className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-colors disabled:opacity-50 mb-2"
            >
              {loading ? t("auth.loading") : t("auth.login")}
            </button>
            <button
              onClick={handleSendCode}
              disabled={loading || countdown > 0}
              className="w-full py-2.5 rounded-lg text-text-secondary hover:bg-surface-hover text-sm transition-colors disabled:opacity-50"
            >
              {countdown > 0 ? `${countdown}s` : t("auth.resendCode")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
