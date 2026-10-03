import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowserOcclusion } from "../../hooks/useBrowserOcclusion";
import type { ActionResult, ConnectorEntry } from "../../../shared/connectors";

/**
 * key 型目录条目的「连接」对话框 —— 收一个厂商凭据。
 *
 * 与 OAuth 条目的差别是**没有浏览器这一步**：拿到凭据就直接写配置并生效。
 * 所以这里没有「授权中/取消」那套状态，失败就内联报错、保留输入。
 *
 * 前缀（如 `Bearer `）与参数名都来自目录条目的 `auth` —— 组件不认识任何厂商。
 */
export function KeyDialog({
  entry,
  onClose,
  onConnected,
}: {
  /** null = 关闭。打开时用哪条目录条目 */
  entry: ConnectorEntry | null;
  onClose: () => void;
  /** 写盘成功（可能还等下次对话生效），调用方负责刷新列表与提示 */
  onConnected: (res: ActionResult) => void;
}) {
  const { t } = useTranslation();
  const isOpen = entry !== null;
  useBrowserOcclusion(isOpen);
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Esc 的处理注册在 effect 里，读状态要用 ref（否则闭包拿到旧的 busy）
  const busyRef = useRef(false);
  // onClose 同样走 ref：调用方（ConnectorsView）传的是内联箭头函数，
  // 每次父组件渲染都是新身份 —— 把它放进下面那个「重置输入」的 effect 依赖里，
  // 会把用户**正在粘的凭据清空**（刷新列表、状态推送都会触发父组件渲染）。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // 只在**打开那一次**清空：留上一次的值会让人以为已经填过了
    setCredential("");
    setError("");
    inputRef.current?.focus();
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

  if (!entry) return null;
  const auth = entry.auth;
  if (!auth || auth.kind !== "key") return null;

  const submit = async () => {
    const value = credential.trim();
    if (!value) {
      setError(t("connectors.keyDialog.empty"));
      return;
    }
    setBusy(true);
    busyRef.current = true;
    try {
      const res = await window.electronAPI.connectors.connectWithKey(
        entry.serverName,
        value,
      );
      if (!res.ok) {
        // 失败时**保留输入**，用户改一处即可重试
        setError(res.error ?? t("connectors.keyDialog.failed"));
        return;
      }
      onConnected(res);
      onClose();
    } catch (e) {
      // IPC 本身抛异常（不只是返回 ok:false）也要内联报错，不能静默
      setError(String(e));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
      <div className="card w-full max-w-lg p-5 m-4 shadow-elevated animate-slide-up">
        <p className="text-sm font-medium text-text-primary">
          {t("connectors.keyDialog.title", { name: t(entry.nameKey) })}
        </p>
        <p className="text-xs text-text-muted mt-1">
          {t(auth.credentialLabelKey)}
          {" · "}
          <a
            href={auth.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            {t("connectors.keyDialog.consoleLink")}
          </a>
        </p>
        <input
          ref={inputRef}
          data-testid="key-credential"
          type="password"
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) void submit();
          }}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("connectors.keyDialog.placeholder")}
          className="w-full mt-3 px-3 py-2 rounded-lg border border-border bg-surface font-mono text-xs text-text-primary"
        />
        {error && (
          <p role="alert" className="text-xs text-error mt-2">
            {error}
          </p>
        )}
        <p className="text-[11px] text-text-muted mt-2">
          {t("connectors.keyDialog.storageHint")}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {t("connectors.keyDialog.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover text-sm font-medium transition-colors disabled:opacity-50"
          >
            {t("connectors.keyDialog.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
