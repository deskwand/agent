import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PiUiRequest } from "../../shared/ipc-types";
import type { ServerEvent } from "../types";

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

/**
 * Pi 扩展交互弹窗：监听主进程 pi.ui-request / pi.trust-prompt 事件，
 * 渲染对应对话框并把结果经 piUi.respond / piExtensions.respondTrust 回传。
 */
export function ExtensionDialogs() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<UiDialogState[]>([]);
  const [trustCwd, setTrustCwd] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const dialog = queue[0] ?? null;

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
            ? dialog.prefill ?? ""
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[420px] max-w-[90vw] rounded-xl border border-border bg-panel p-5 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold">
              {t("piExtensions.trustTitle")}
            </h3>
            <p className="mb-4 text-sm text-muted-foreground break-all">
              {t("piExtensions.trustMessage", { cwd: trustCwd })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg px-4 py-2 text-sm bg-danger text-white"
                onClick={() => respondTrust("untrusted")}
              >
                {t("piExtensions.trustDeny")}
              </button>
              <button
                className="rounded-lg px-4 py-2 text-sm bg-primary text-primary-foreground"
                onClick={() => respondTrust("trusted")}
              >
                {t("piExtensions.trustAllow")}
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[420px] max-w-[90vw] rounded-xl border border-border bg-panel p-5 shadow-2xl">
            <h3 className="mb-2 text-base font-semibold">{dialog.title}</h3>
            {dialog.kind === "confirm" && (
              <p className="mb-4 text-sm text-muted-foreground">
                {dialog.message}
              </p>
            )}
            {dialog.kind === "select" && (
              <ul className="mb-4 max-h-64 overflow-auto rounded-lg border border-border">
                {dialog.options.map((option) => (
                  <li
                    key={option}
                    className="cursor-pointer border-b border-border/50 px-3 py-2 text-sm hover:bg-accent"
                    onClick={() => respond(option)}
                  >
                    {option}
                  </li>
                ))}
              </ul>
            )}
            {(dialog.kind === "input" || dialog.kind === "editor") && (
              <textarea
                className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                rows={dialog.kind === "editor" ? 6 : 1}
                placeholder={dialog.kind === "input" ? dialog.placeholder : ""}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg px-4 py-2 text-sm border border-border"
                onClick={() => respond(undefined)}
              >
                {t("common.cancel")}
              </button>
              {dialog.kind !== "select" && (
                <button
                  className="rounded-lg px-4 py-2 text-sm bg-primary text-primary-foreground"
                  onClick={() => respond(inputValue)}
                >
                  {t("common.confirm")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
