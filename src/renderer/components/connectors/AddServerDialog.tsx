import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { OccludingDialog } from "../ui/occluding-dialog";
import { DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { Button } from "../app-button";

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

/**
 * payload 输入区。
 *
 * ⚠️ **为什么它是一个独立组件**：Radix 的 `Presence` 把弹窗内容**延后一帧**挂载，
 * 所以外层组件 `useEffect(…, [])` 跑的时候 `textareaRef.current` 还是 `null`，
 * 那时的 `focus()` 是空操作（实测 `document.activeElement` 是 `BODY`）。
 * 抽成子组件后它的生命周期与内容对齐，ref 在自己的 effect 里一定可用。
 */
function PayloadTextarea({
  textareaRef,
  value,
  placeholder,
  onChange,
}: {
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  useEffect(() => {
    textareaRef.current?.focus();
  }, [textareaRef]);

  return (
    <Textarea
      ref={textareaRef}
      data-testid="add-payload"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
      placeholder={placeholder}
      className="mt-3 h-40 min-h-0 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-primary shadow-none"
    />
  );
}

export function AddServerDialog({
  isOpen,
  onClose,
  onAdded,
}: AddServerDialogProps) {
  const { t } = useTranslation();
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // busy 的处理在 onOpenChange 里，读状态要用 ref（否则闭包拿到旧的 busy）
  const busyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 打开时清掉上一次的残留错误（输入内容保留，便于改一处重试）。
  // Esc 的监听已删除：Radix 接手，busy 守卫移到下面的 onOpenChange。
  // 聚焦也搬进了 PayloadTextarea（见那个组件的文档块）。
  useEffect(() => {
    if (!isOpen) return;
    setError("");
  }, [isOpen]);

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
    <OccludingDialog
      open={isOpen}
      onOpenChange={(next) => {
        // busy 时忽略一切关闭请求。
        // 原实现只挡 Esc（window keydown 里查 busyRef）；Radix 引入了另外两条
        // 关闭路径（遮罩点击、DialogContent 内置的关闭键），所以守卫放在这里统一挡：
        // 请求已经在飞，关掉窗口会让「加成功了吗」变得不确定。
        if (!next && !busyRef.current) onClose();
      }}
    >
      <DialogContent className="max-w-lg p-5">
        <DialogTitle className="text-sm font-medium text-text-primary">
          {t("connectors.add.title")}
        </DialogTitle>
        <DialogDescription className="text-xs text-text-muted mt-1">
          {t("connectors.add.hint")}
        </DialogDescription>
        <PayloadTextarea
          textareaRef={textareaRef}
          value={payload}
          placeholder={
            '{\n  "mcpServers": {\n    "my-tools": { "type": "stdio", "command": "npx", "args": ["-y", "some-mcp"] }\n  }\n}'
          }
          onChange={setPayload}
        />
        {error && (
          <p role="alert" className="text-xs text-error mt-2">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost"
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors h-auto"
          >
            {t("common.cancel")}
          </Button>
          <Button variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-sm font-medium transition-colors disabled:opacity-50 h-auto"
          >
            {t("connectors.action.add")}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
