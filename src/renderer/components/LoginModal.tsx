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

type LoginStep = "social" | "email" | "code";

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

async function completeLogin(
  result: {
    token: string;
    user: { email: string; level: string; credits_balance: number };
  },
  onSuccess: (config: CloudConfig) => void,
): Promise<void> {
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
  onSuccess(config);
}

export function LoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
}: LoginModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<LoginStep>("social");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setStep("social");
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

  // ── Google 登录 ──

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await window.electronAPI.cloudAuth.googleLogin();
      await completeLogin(result, onLoginSuccess);
      onClose();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "USER_CANCELLED" || err.code === "TIMEOUT") {
        // 用户取消或超时，不显示错误，回到初始状态；finally 会重置 loading
        return;
      }
      setError(
        err.code
          ? (t(`auth.errorCodes.${err.code}`, err.message ?? "") as string)
          : err.message || t("auth.loginFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

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
      await completeLogin(result, onLoginSuccess);
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

        {/* ── Google 登录 ── */}
        {step === "social" && (
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-background hover:bg-surface-hover border border-border text-text-primary text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <GoogleIcon />
            {t("auth.googleLogin")}
          </button>
        )}

        {/* ── 邮箱登录入口 ── */}
        {step === "social" && (
          <div className="text-center mt-4">
            <button
              onClick={() => {
                setStep("email");
                setTimeout(() => emailRef.current?.focus(), 100);
              }}
              disabled={loading}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors disabled:opacity-50"
            >
              {t("auth.emailFallback")}
            </button>
          </div>
        )}

        {step === "email" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => {
                  setStep("social");
                  setError(null);
                }}
                disabled={loading}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors disabled:opacity-50"
              >
                {t("auth.backToSelect")}
              </button>
              <span className="text-xs text-text-secondary font-medium ml-1">
                {t("auth.emailLoginTitle")}
              </span>
            </div>
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
              disabled={loading || !email.trim()}
              className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-colors disabled:opacity-50 mb-2"
            >
              {loading ? t("auth.loading") : t("auth.nextStep")}
            </button>
          </>
        )}

        {step === "code" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => {
                  setStep("social");
                  setError(null);
                }}
                disabled={loading}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors disabled:opacity-50"
              >
                {t("auth.backToSelect")}
              </button>
              <span className="text-xs text-text-secondary font-medium ml-1">
                {t("auth.emailLoginTitle")}
              </span>
            </div>
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
