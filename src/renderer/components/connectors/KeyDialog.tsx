import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../ui/input";
import { Button } from "../app-button";
import type { ActionResult, ConnectorEntry } from "../../../shared/connectors";
import { OccludingDialog } from "../ui/occluding-dialog";
import { DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

/**
 * 凭据输入框。
 *
 * ⚠️ **为什么它是一个独立组件**：Radix 的 `Presence` 把弹窗内容**延后一帧**挂载，
 * 所以外层组件 `useEffect(…, [])` 跑的时候 `inputRef.current` 还是 `null`，
 * 那时的 `focus()` 是空操作（实测 `document.activeElement` 是 `BODY`）。
 * 抽成子组件后它的生命周期与内容对齐，ref 在自己的 effect 里一定可用。
 */
function CredentialInput({
  inputRef,
  value,
  disabled,
  placeholder,
  onChange,
  onSubmitKey,
}: {
  inputRef: MutableRefObject<HTMLInputElement | null>;
  value: string;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmitKey: () => void;
}) {
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return (
    <Input
      ref={inputRef}
      data-testid="key-credential"
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !disabled) onSubmitKey();
      }}
      spellCheck={false}
      autoComplete="off"
      placeholder={placeholder}
      className="w-full mt-3 px-3 py-2 rounded-lg border border-border bg-card font-mono text-xs text-foreground"
    />
  );
}

/**
 * key 型目录条目的「连接」对话框 —— 收一个厂商凭据。
 *
 * 与 OAuth 条目的差别是**没有浏览器这一步**：拿到凭据就直接写配置并生效。
 * 所以这里没有「授权中/取消」那套状态，失败就内联报错、保留输入。
 *
 * 前缀（如 `Bearer `）与参数名都来自目录条目的 `auth` —— 组件不认识任何厂商。
 *
 * 外壳由 shadcn 的 Dialog 承担，occlusion 由 OccludingDialog 承担
 *（迁移前是本组件手写的 `useBrowserOcclusion(isOpen)`）。原实现还手写了一个
 * window keydown 监听来拦 Esc —— 那条已删除（Radix 接手），但 busy 守卫保留，
 * 只是移进了 `onOpenChange`：Radix 让关闭路径从 1 条变成 3 条
 *（Esc / 遮罩点击 / 内置关闭键），守卫必须统一挡。
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
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // busy 的处理在 onOpenChange 里，读状态要用 ref（否则闭包拿到旧的 busy）
  const busyRef = useRef(false);
  // onClose 同样走 ref：调用方（ConnectorsView）传的是内联箭头函数，
  // 每次父组件渲染都是新身份 —— 把它放进下面那个「重置输入」的 effect 依赖里，
  // 会把用户**正在粘的凭据清空**（刷新列表、状态推送都会触发父组件渲染）。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // 只在**打开那一次**清空：留上一次的值会让人以为已经填过了
    setCredential("");
    setError("");
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
    <OccludingDialog
      open={isOpen}
      onOpenChange={(next) => {
        // busy 时忽略一切关闭请求。
        // 原实现只挡 Esc（window keydown 里查 busyRef）；Radix 引入了另外两条
        // 关闭路径（遮罩点击、DialogContent 内置的关闭键），所以守卫放在这里统一挡：
        // 请求已经在飞，关掉窗口会让「加成功了吗」变得不确定。
        if (!next && !busyRef.current) onCloseRef.current();
      }}
    >
      <DialogContent className="max-w-lg p-5">
        <DialogTitle className="text-sm font-medium text-foreground">
          {t("connectors.keyDialog.title", { name: t(entry.nameKey) })}
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground mt-1">
          {t(auth.credentialLabelKey)}
          {" · "}
          <a
            href={auth.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary-text hover:underline"
          >
            {t("connectors.keyDialog.consoleLink")}
          </a>
        </DialogDescription>
        <CredentialInput
          inputRef={inputRef}
          value={credential}
          disabled={busy}
          placeholder={t("connectors.keyDialog.placeholder")}
          onChange={setCredential}
          onSubmitKey={() => void submit()}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive mt-2">
            {error}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          {t("connectors.keyDialog.storageHint")}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            className="h-auto px-3 py-1.5 rounded-lg text-sm font-normal text-muted-foreground hover:bg-hover-surface hover:text-muted-foreground"
          >
            {t("connectors.keyDialog.cancel")}
          </Button>
          <Button
            variant="default"
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-auto px-3 py-1.5 rounded-lg text-sm hover:bg-primary/90"
          >
            {t("connectors.keyDialog.submit")}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
