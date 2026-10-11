import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PiUiRequest } from "../../shared/ipc-types";
import type { ServerEvent } from "../types";
import { Textarea } from "./ui/textarea";
import { Button } from "./app-button";
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { OccludingAlertDialog, OccludingDialog } from "./ui/occluding-dialog";

export type UiDialogState =
  | { id: string; kind: "select"; title: string; options: string[] }
  | { id: string; kind: "confirm"; title: string; message?: string }
  | { id: string; kind: "input"; title: string; placeholder?: string }
  | { id: string; kind: "editor"; title: string; prefill?: string };

/** 将官方 RPC 形状的 PiUiRequest 归一为 renderer 对话框状态。 */
export function reduceUiRequest(request: PiUiRequest): UiDialogState | null {
  switch (request.method) {
    case "select":
      return {
        id: request.id,
        kind: "select",
        title: request.title,
        options: request.options ?? [],
      };
    case "confirm":
      return {
        id: request.id,
        kind: "confirm",
        title: request.title,
        message: request.message,
      };
    case "input":
      return {
        id: request.id,
        kind: "input",
        title: request.title,
        placeholder: request.placeholder,
      };
    case "editor":
      return {
        id: request.id,
        kind: "editor",
        title: request.title,
        prefill: request.prefill,
      };
  }
}

interface ExtensionDialogsProps {
  /** 事件入口没有可恢复的本地焦点目标时的背景 fallback（App 传 <main>）。 */
  onRestoreFocus?: () => void;
}

/**
 * Pi 扩展交互弹窗：监听主进程 pi.ui-request / pi.trust-prompt 事件，
 * 渲染对应对话框并把结果经 piUi.respond / piExtensions.respondTrust 回传。
 */
export function ExtensionDialogs({
  onRestoreFocus,
}: ExtensionDialogsProps = {}) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<UiDialogState[]>([]);
  const [trustCwd, setTrustCwd] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const dialog = queue[0] ?? null;

  // 请求弹窗与信任提示是两个可以同时打开的层，各自记自己的返回目标。
  // 队列整体只在“从无请求到首请求”这一段捕获，换下一请求保留最初目标。
  const requestReturnFocusRef = useRef<HTMLElement | null>(null);
  const trustReturnFocusRef = useRef<HTMLElement | null>(null);

  const captureReturnFocus = (ref: typeof requestReturnFocusRef) => () => {
    if (ref.current) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      ref.current = active;
    }
  };

  /** 关闭的默认回焦被阻止后，优先回本地有效目标，落不到焦才走背景 fallback。 */
  const restoreReturnFocus =
    (ref: typeof requestReturnFocusRef) => (event: Event) => {
      event.preventDefault();
      const target = ref.current;
      ref.current = null;
      if (target?.isConnected && !target.matches(":disabled")) {
        target.focus({ preventScroll: true });
        if (document.activeElement !== target) onRestoreFocus?.();
      } else {
        onRestoreFocus?.();
      }
    };

  /**
   * 队列门：Radix 的关闭回焦在 setTimeout(0) 里跑，闭包里的 state 还是关闭前那次渲染的，
   * 所以按 DOM 判断是否还有别的层（下一请求 / 信任提示）开着；有就让位，不回背景。
   */
  const restoreRequestFocus = (event: Event) => {
    const stillOccluded = document.querySelector(
      '[role="dialog"], [role="alertdialog"]',
    );
    if (stillOccluded) {
      event.preventDefault();
      return;
    }
    restoreReturnFocus(requestReturnFocusRef)(event);
  };

  /**
   * Radix 的隐式关闭路径（遮罩 / Escape / Close）只走 onOpenChange。
   * 这里一律吞掉：关闭只能经 respond / respondTrust 两个显式出口，
   * 否则队列推进后旧 Content 的 close 事件会顺手取消下一个请求。
   */
  const ignoreOpenChange = (open: boolean) => {
    if (open) return;
  };

  useEffect(() => {
    return window.electronAPI.on((event: ServerEvent) => {
      if (event.type === "pi.ui-request") {
        const state = reduceUiRequest(event.payload);
        if (state) {
          setQueue((prev) => [...prev, state]);
        }
      }
      if (event.type === "pi.trust-prompt") {
        setTrustCwd(event.payload.cwd);
      }
    });
  }, []);

  const closeDialog = () => setQueue((prev) => prev.slice(1));

  // dialog 切换时重置输入框内容（队列化后的事件回调不再直接 setInputValue）
  useEffect(() => {
    if (dialog) {
      setInputValue(
        dialog.kind === "editor" || dialog.kind === "input"
          ? dialog.kind === "editor"
            ? (dialog.prefill ?? "")
            : ""
          : "",
      );
    }
  }, [dialog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const respond = (result: unknown) => {
    if (dialog) {
      window.electronAPI.piUi.respond(dialog.id, result);
    }
    closeDialog();
  };

  const respondTrust = (decision: "trusted" | "untrusted" | "cancel") => {
    if (trustCwd) {
      window.electronAPI.piExtensions.respondTrust(trustCwd, decision);
    }
    setTrustCwd(null);
  };

  if (!dialog && !trustCwd) return null;

  return (
    <>
      {trustCwd && (
        <OccludingAlertDialog open onOpenChange={ignoreOpenChange}>
          <AlertDialogContent
            className="w-[420px] max-w-[90vw] gap-0 rounded-xl border-border bg-card p-5 shadow-2xl"
            onEscapeKeyDown={(event) => event.preventDefault()}
            onOpenAutoFocus={captureReturnFocus(trustReturnFocusRef)}
            onCloseAutoFocus={restoreReturnFocus(trustReturnFocusRef)}
          >
            <AlertDialogHeader className="mb-4 space-y-2 text-left">
              <AlertDialogTitle className="text-base font-semibold">
                {t("piExtensions.trustTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-normal text-muted-foreground break-all">
                {/*
                  文案里的占位符是单花括号 `{cwd}`，而 i18next 默认只认 `{{cwd}}` ——
                  不显式指定 prefix/suffix 的话界面上会原样显示 "{cwd}"。只在这一条
                  消息上开单花括号插值，不改全局 interpolation 配置、也不动 locale 文案。
                */}
                {t("piExtensions.trustMessage", {
                  cwd: trustCwd,
                  interpolation: { prefix: "{", suffix: "}" },
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
              <AlertDialogCancel
                onClick={(event) => {
                  event.preventDefault();
                  respondTrust("untrusted");
                }}
              >
                {t("piExtensions.trustDeny")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  respondTrust("trusted");
                }}
              >
                {t("piExtensions.trustAllow")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </OccludingAlertDialog>
      )}
      {dialog && dialog.kind === "confirm" && (
        <OccludingAlertDialog open onOpenChange={ignoreOpenChange}>
          <AlertDialogContent
            className="w-[420px] max-w-[90vw] gap-0 rounded-xl border-border bg-card p-5 shadow-2xl"
            onEscapeKeyDown={(event) => event.preventDefault()}
            onOpenAutoFocus={captureReturnFocus(requestReturnFocusRef)}
            onCloseAutoFocus={restoreRequestFocus}
          >
            <AlertDialogHeader className="mb-4 space-y-2 text-left">
              <AlertDialogTitle className="text-base font-semibold">
                {dialog.title}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-normal text-muted-foreground">
                {dialog.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
              <AlertDialogCancel
                onClick={(event) => {
                  event.preventDefault();
                  respond(undefined);
                }}
              >
                {t("common.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  respond(inputValue);
                }}
              >
                {t("common.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </OccludingAlertDialog>
      )}
      {dialog && dialog.kind !== "confirm" && (
        <OccludingDialog open onOpenChange={ignoreOpenChange}>
          <DialogContent
            className="w-[420px] max-w-[90vw] gap-0 rounded-xl border-border bg-card p-5 shadow-2xl [&>button]:hidden"
            aria-describedby={undefined}
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onOpenAutoFocus={captureReturnFocus(requestReturnFocusRef)}
            onCloseAutoFocus={restoreRequestFocus}
          >
            <DialogHeader className="mb-4 space-y-2 text-left">
              <DialogTitle className="text-base font-semibold">
                {dialog.title}
              </DialogTitle>
            </DialogHeader>
            {dialog.kind === "select" && (
              <ul className="mb-4 max-h-64 overflow-auto rounded-lg border border-border">
                {dialog.options.map((option) => (
                  <li
                    key={option}
                    className="border-b border-border/50 last:border-b-0"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-start rounded-none px-3 py-2 text-left text-sm font-normal"
                      onClick={() => respond(option)}
                    >
                      {option}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {(dialog.kind === "input" || dialog.kind === "editor") && (
              <Textarea
                className="mb-4 min-h-0 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-none"
                rows={dialog.kind === "editor" ? 6 : 1}
                placeholder={dialog.kind === "input" ? dialog.placeholder : ""}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            )}
            <DialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
              <Button variant="outline" onClick={() => respond(undefined)}>
                {t("common.cancel")}
              </Button>
              {dialog.kind !== "select" && (
                <Button onClick={() => respond(inputValue)}>
                  {t("common.confirm")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </OccludingDialog>
      )}
    </>
  );
}
