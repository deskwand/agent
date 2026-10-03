import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowserOcclusion } from "../../hooks/useBrowserOcclusion";

/**
 * 「一次加一台」在 **UI 层**保证。
 *
 * 后端 `addCustomServer` 接受一次性多台（`mcpServers` 里多个键），也有测试断言这一点。
 * 「一次加一台」是交互要求，所以在这里收敛 —— **不动后端契约**。
 *
 * 主流客户端的「添加」动作也都是一台（Claude Desktop 的 Add custom connector、
 * VS Code 的 MCP: Add Server、Claude Code 的 `mcp add`）；多台只出现在「直接编辑配置文件」。
 */
export function validateSingleServerPayload(
  raw: string,
):
  | { ok: true; payload: string }
  | { ok: false; error: string }
  | { ok: false; multiServer: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${(error as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "top level must be an object" };
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (
    typeof servers !== "object" ||
    servers === null ||
    Array.isArray(servers)
  ) {
    return { ok: false, error: "missing mcpServers object" };
  }
  const keys = Object.keys(servers);
  if (keys.length === 0) return { ok: false, error: "mcpServers is empty" };
  if (keys.length > 1) {
    // 说清怎么办，不只说「错了」——否则用户会重复添加。
    // 文案交给组件走 i18n（这里只回台数）。
    return { ok: false, multiServer: keys.length };
  }
  return { ok: true, payload: raw };
}

interface AddServerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 添加成功后调用 —— 由调用方刷新列表 */
  onAdded: () => void;
}

export function AddServerDialog({
  isOpen,
  onClose,
  onAdded,
}: AddServerDialogProps) {
  const { t } = useTranslation();
  useBrowserOcclusion(isOpen);
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Esc 的处理注册在 effect 里，读状态要用 ref（否则闭包拿到旧的 busy）
  const busyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 打开时聚焦输入框；Esc 与「取消」等效
  useEffect(() => {
    if (!isOpen) return;
    // 每次打开都清掉上一次的残留错误（输入内容保留，便于改一处重试）
    setError("");
    textareaRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // busy 时不响应 Esc：请求已经在飞，关掉窗口会让「加成功了吗」变得不确定
      if (event.key === "Escape" && !busyRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submit = async () => {
    const checked = validateSingleServerPayload(payload);
    if (!checked.ok) {
      setError(
        "multiServer" in checked
          ? t("connectors.add.multiServer", { count: checked.multiServer })
          : checked.error,
      );
      return;
    }
    setBusy(true);
    busyRef.current = true;
    try {
      const result = await window.electronAPI.connectors.addCustomServer({
        kind: "json",
        payload: checked.payload,
      });
      if (!result.ok) {
        // 失败时**保留输入**（含错误），用户改一处即可重试
        setError(result.error ?? "unknown error");
        return;
      }
      setPayload("");
      setError("");
      onAdded();
      onClose();
    } catch (error) {
      // IPC 本身抛异常（不只是返回 ok:false）也要内联报错，不能静默
      setError(String(error));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
      <div className="card w-full max-w-lg p-5 m-4 shadow-elevated animate-slide-up">
        <p className="text-sm font-medium text-text-primary">
          {t("connectors.add.title")}
        </p>
        <p className="text-xs text-text-muted mt-1">
          {t("connectors.add.hint")}
        </p>
        <textarea
          ref={textareaRef}
          data-testid="add-payload"
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          spellCheck={false}
          placeholder={
            '{\n  "mcpServers": {\n    "my-tools": { "type": "stdio", "command": "npx", "args": ["-y", "some-mcp"] }\n  }\n}'
          }
          className="w-full h-40 mt-3 px-3 py-2 rounded-lg border border-border bg-surface font-mono text-xs text-text-primary"
        />
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
            disabled={busy}
            onClick={() => void submit()}
            className="px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover text-sm font-medium transition-colors disabled:opacity-50"
          >
            {t("connectors.action.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
