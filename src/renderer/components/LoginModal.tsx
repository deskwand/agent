import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CloudApiClient } from "../services/cloud-api";
import { DESKWAND_API_URL } from "../../shared/oauth-config";
import { buildDeskwandProviderPayload } from "../utils/cloud-provider";
import type { CloudConfig } from "../types";
import { OccludingDialog } from "./ui/occluding-dialog";
import { DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./app-button";

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
    user: { email: string; level: string; balance_micro_usd: number };
  },
  t: (key: string, opts?: { defaultValue: string }) => string,
  onSuccess: (config: CloudConfig) => void,
): Promise<void> {
  const cloudApi = new CloudApiClient(result.token);
  const config: CloudConfig = {
    serverUrl: DESKWAND_API_URL,
    token: result.token,
    isLoggedIn: true,
    email: result.user.email,
    level: result.user.level,
    balanceMicroUsd: result.user.balance_micro_usd,
  };
  try {
    const pricing = await cloudApi.getPricing();
    const payload = buildDeskwandProviderPayload(
      pricing.models,
      result.token,
      t,
    );
    // 登录前是否已有可用 provider —— 决定登录后要不要接管默认模型。
    const alreadyConfigured = await window.electronAPI.config.isConfigured();
    if (payload.config.models.length > 0) {
      const saved = await window.electronAPI.config.saveProvider(payload);
      console.log(
        "[cloud] provider injected:",
        payload.profileKey,
        "success:",
        saved?.success,
        "models:",
        payload.config.models.length,
      );
      const defaultModel =
        saved?.config?.providers?.[payload.profileKey]?.defaultModel;
      // 只在没有别的可用 provider 时才切 active：账号菜单也能打开这个弹窗，
      // 那时用户可能已有自己的 Key，默认模型是他选的，不能动。
      if (!alreadyConfigured && defaultModel) {
        await window.electronAPI.config.setActiveProvider({
          profileKey: payload.profileKey,
          defaultModel,
        });
      }
    } else {
      console.warn(
        "[cloud] pricing returned no models — skipping provider injection",
      );
    }
  } catch (e) {
    console.error("[cloud] provider injection failed:", e);
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
      await completeLogin(result, t, onLoginSuccess);
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
      await completeLogin(result, t, onLoginSuccess);
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

  return (
    <OccludingDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* 关于 DialogContent 自带的那颗关闭 X：原实现**没有**关闭键，所以它是
          迁移新增的一条关闭路径。**不构成回归** —— 原实现的遮罩上有 onClick={onClose}，
          也就是说 loading 中途本来就能点遮罩关掉；新路径没有收紧也没有放宽可中断的时机。
          本弹窗**不加** busy 守卫：原实现也没有（loading 只禁用按钮，不拦关闭）。 */}
      <DialogContent className="max-w-sm p-6">
        <DialogTitle className="text-base font-semibold text-foreground mb-5 text-center">
          {t("auth.loginTitle")}
        </DialogTitle>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* ── Google 登录 ── */}
        {step === "social" && (
          <Button variant="ghost"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-background hover:bg-accent border border-border text-foreground text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 h-auto"
          >
            <GoogleIcon />
            {t("auth.googleLogin")}
          </Button>
        )}

        {/* ── 邮箱登录入口 ── */}
        {step === "social" && (
          <div className="text-center mt-4">
            <Button variant="ghost"
              onClick={() => {
                setStep("email");
                setTimeout(() => emailRef.current?.focus(), 100);
              }}
              disabled={loading}
              className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors disabled:opacity-50 h-auto"
            >
              {t("auth.emailFallback")}
            </Button>
          </div>
        )}

        {step === "email" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Button variant="ghost"
                onClick={() => {
                  setStep("social");
                  setError(null);
                }}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors disabled:opacity-50 h-auto"
              >
                {t("auth.backToSelect")}
              </Button>
              <span className="text-xs text-muted-foreground font-medium ml-1">
                {t("auth.emailLoginTitle")}
              </span>
            </div>
            <div className="mb-4">
              <Input
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendCode();
                }}
                placeholder={t("auth.emailPlaceholder")}
                disabled={loading}
                className="h-auto w-full rounded-lg border border-border bg-accent px-3 py-2 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>
            <Button variant="ghost"
              onClick={handleSendCode}
              disabled={loading || !email.trim()}
              className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors disabled:opacity-50 mb-2 h-auto"
            >
              {loading ? t("auth.loading") : t("auth.nextStep")}
            </Button>
          </>
        )}

        {step === "code" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Button variant="ghost"
                onClick={() => {
                  setStep("social");
                  setError(null);
                }}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors disabled:opacity-50 h-auto"
              >
                {t("auth.backToSelect")}
              </Button>
              <span className="text-xs text-muted-foreground font-medium ml-1">
                {t("auth.emailLoginTitle")}
              </span>
            </div>
            <div className="mb-4 p-2.5 rounded-lg bg-success/10 border border-success/20 text-xs text-success">
              {t("auth.codeSent")} {email}
            </div>
            <div className="mb-4">
              <Input
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
                className="h-auto w-full rounded-lg border border-border bg-accent px-3 py-2 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50 text-center tracking-[0.5em]"
              />
            </div>
            <Button variant="ghost"
              onClick={handleLogin}
              disabled={loading || code.length < 6}
              className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors disabled:opacity-50 mb-2 h-auto"
            >
              {loading ? t("auth.loading") : t("auth.login")}
            </Button>
            <Button variant="ghost"
              onClick={handleSendCode}
              disabled={loading || countdown > 0}
              className="w-full py-2.5 rounded-lg text-muted-foreground hover:bg-accent text-sm transition-colors disabled:opacity-50"
            >
              {countdown > 0 ? `${countdown}s` : t("auth.resendCode")}
            </Button>
          </>
        )}
      </DialogContent>
    </OccludingDialog>
  );
}
