import { ExternalLink } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { Tooltip } from "./Tooltip";

/**
 * 次级入口：用系统程序打开。预览抢走主点击后，文件树/筛选结果/产物面板里这是
 * `openPath` 唯一的入口，所以它的作用是"避免能力倒退"而不是新增功能。
 *
 * 单动作（不带菜单）：消息附件那处已经有独立的"在文件夹中显示"，把它也塞进来
 * 会在同一位置产生重复入口（见 design §5.5）。
 *
 * 注意：本组件渲染 `<button>`。若宿主行本身是 `<button>`，必须先把宿主换成
 * `<div role="button">` —— 嵌套 `<button>` 是非法 HTML（见 plan Task 8）。
 */
export function OpenWithSystemAppButton({
  filePath,
  className,
}: {
  filePath: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  const handleClick = useCallback(
    async (event: React.MouseEvent) => {
      // 宿主行自己有 onClick（选择）/onDoubleClick（打开），这里必须阻止冒泡。
      event.stopPropagation();
      if (!window.electronAPI?.openPath) return;
      const result = await window.electronAPI.openPath(filePath);
      if (result.error) {
        setGlobalNotice({
          id: `open-system-app-failed-${Date.now()}`,
          type: "warning",
          message: t("context.openFailed", { error: result.error }),
        });
      }
    },
    [filePath, setGlobalNotice, t],
  );

  return (
    <Tooltip label={t("filePreview.openExternal")}>
      <button
        type="button"
        data-testid="open-with-system-app"
        aria-label={t("filePreview.openExternal")}
        onClick={handleClick}
        // 快速双击 ⧉ 时第二次点击会走 dblclick：只拦 click 的话宿主行的
        // onDoubleClick（打开预览）仍会被触发，于是"用系统程序打开"的同时又跑了预览。
        onDoubleClick={(event) => event.stopPropagation()}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors text-text-muted hover:bg-surface-hover hover:text-text-primary ${className ?? ""}`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}
