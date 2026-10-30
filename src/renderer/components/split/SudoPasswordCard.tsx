import {
  useRef,
  useEffect,
  type ElementType,
  type MutableRefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { useIPC } from "../../hooks/useIPC";
import type { SudoPasswordRequest } from "../../types";
import { Shield, X, Play } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../app-button";

export interface SudoPasswordCardProps {
  request: SudoPasswordRequest;
  extraCount?: number;
  sessionTitle?: string;
  onJump?: () => void;
  /** Dialog 外壳传入 AlertDialogTitle / Description 以保留读屏语义；默认普通元素。 */
  titleAs?: ElementType;
  descriptionAs?: ElementType;
}

/**
 * 密码输入框。
 *
 * ⚠️ **为什么它必须是一个独立组件，而不是写在外层里**
 *
 * Radix 的 `Presence` 会把弹窗内容**延后一帧**挂载，于是外层组件自己的
 * `useEffect(…, [])` 跑的时候 `inputRef.current` 还是 `null`。实测症状有两个，
 * 同出一个原因：mount 后 `document.activeElement` 是 `BODY`（输入框没拿到焦点），
 * 且「卸载时擦掉 DOM 里的值」那次元素快照也快照到了 null。
 *
 * 抽成子组件后，它的生命周期与内容对齐：随内容一起挂载，ref 在它自己的 effect 里
 * 一定可用。既不用 `onOpenAutoFocus` 这类 Radix 专属钩子，也不用加 state
 * 去「等元素出现」。
 *
 * ref 由父组件持有并以普通 prop 传入（不是 `ref` 属性）——提交/取消时父组件
 * 要能直接清空它，而那两个时刻内容早已挂载，`inputRef.current` 一定可用。
 */
function PasswordInput({
  inputRef,
  passwordRef,
  onKeyDown,
  label,
  placeholder,
}: {
  inputRef: MutableRefObject<HTMLInputElement | null>;
  passwordRef: MutableRefObject<string>;
  onKeyDown: (e: React.KeyboardEvent) => void;
  label: string;
  placeholder: string;
}) {
  useEffect(() => {
    inputRef.current?.focus();
    // Capture ref values for safe use in cleanup
    const inputEl = inputRef.current;
    // Clear the password from memory when the input unmounts
    return () => {
      passwordRef.current = "";
      if (inputEl) {
        inputEl.value = "";
      }
    };
  }, [inputRef, passwordRef]);

  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-foreground mb-1">
        {label}
      </label>
      {/* 2026-10-09 相位 3 ✓：`Input` 是 `forwardRef` ⇒ `inputRef` 照常落到真实 `<input>` 上 ✓。
          本仓聚焦是 `focus:ring-2 ring-primary/50` ✓；base 的 `focus-visible:ring-1 ring-ring` 会**再叠一圈** ✗
          ⇒ 按口径裁决②**照原样复刻**成 2px 环（`focus-visible:ring-2 focus-visible:ring-primary/50` ✓ —— 本处原串自带 2px 环 ✓，复刻 = 保持现状 ✗ 不是引入新风格 ✓）；其余逐条覆盖（h-auto / rounded-lg / border-border / bg-card / py-2 / shadow-none）✓。 */}
      <Input
        ref={inputRef}
        type="password"
        onChange={(e) => {
          passwordRef.current = e.target.value;
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="h-auto w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        autoComplete="new-password"
      />
    </div>
  );
}

/** sudo 密码卡片主体：Dialog 外壳与分屏区域内联展示共用。 */
export function SudoPasswordCard({
  request,
  extraCount,
  sessionTitle,
  onJump,
  titleAs: TitleTag = "h3",
  descriptionAs: DescriptionTag = "p",
}: SudoPasswordCardProps) {
  const { t } = useTranslation();
  const { respondToSudoPassword } = useIPC();
  // Use ref so the password never lives in React state / re-render cycle
  const passwordRef = useRef<string>("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = () => {
    const pwd = passwordRef.current;
    if (!pwd) return;
    respondToSudoPassword(request.toolUseId, pwd);
    // Wipe immediately after sending
    passwordRef.current = "";
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleCancel = () => {
    respondToSudoPassword(request.toolUseId, null);
    passwordRef.current = "";
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <div>
      {sessionTitle && (
        <div className="mb-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="truncate">
            {t("split.permissionFromSession", { name: sessionTitle })}
          </span>
          {onJump && (
            <Button
              variant="ghost"
              onClick={onJump}
              className="h-auto flex-shrink-0 rounded-lg px-2 py-1 text-sm text-primary-text hover:bg-hover-surface"
            >
              {t("split.jumpToSession")}
            </Button>
          )}
        </div>
      )}
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-warning/10">
          <Shield className="w-6 h-6 text-warning" />
        </div>

        <div className="flex-1">
          <TitleTag className="text-lg font-semibold text-foreground">
            {t("sudo.title")}
          </TitleTag>
          {/* Description 供读屏补充一句上下文（Radix 不强制要求） */}
          <DescriptionTag className="text-sm text-muted-foreground mt-1">
            {t("sudo.description")}
          </DescriptionTag>
        </div>
      </div>

      {/* Command display */}
      <div className="mt-4 p-4 bg-muted rounded-xl">
        <pre className="text-xs code-block max-h-32 overflow-auto whitespace-pre-wrap break-all">
          {request.command}
        </pre>
      </div>

      {/* Password input */}
      <PasswordInput
        inputRef={inputRef}
        passwordRef={passwordRef}
        onKeyDown={handleKeyDown}
        label={t("sudo.passwordLabel")}
        placeholder={t("sudo.passwordPlaceholder")}
      />

      {/* Warning */}
      <div className="mt-3 p-3 bg-warning/10 border border-warning/20 rounded-xl">
        <p className="text-xs text-warning">{t("sudo.warning")}</p>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-3">
        <Button
          variant="ghost"
          type="button"
          onClick={handleCancel}
          className="h-auto flex-1 gap-2 rounded-lg bg-card px-3 py-1.5 text-sm font-normal text-foreground hover:bg-hover-surface hover:text-foreground"
        >
          <X className="w-4 h-4" />
          {t("sudo.cancel")}
        </Button>

        <Button
          variant="default"
          type="button"
          onClick={handleSubmit}
          className="h-auto flex-1 gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-primary/90"
        >
          <Play className="w-4 h-4" />
          {t("sudo.execute")}
        </Button>
      </div>
      {extraCount ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("split.moreSudoRequests", { count: extraCount })}
        </p>
      ) : null}
    </div>
  );
}
