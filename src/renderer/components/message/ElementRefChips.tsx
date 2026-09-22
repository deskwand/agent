// 已发送气泡里的元素引用 chip。输入框的磁贴会在发送后清空，气泡这份是
// 「我这句话指的是哪个元素」的唯一痕迹——它必须活得比磁贴久。
import { MousePointerSquareDashed } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ElementSelectionRef } from "../../../shared/ipc-types";
import { useAppStore } from "../../store";

export function ElementRefChips({
  selections,
}: {
  selections: ElementSelectionRef[];
}) {
  const { t } = useTranslation();
  if (selections.length === 0) return null;

  // 回到真实页面里定位：先把面板显示出来（否则高亮看不见，用户会以为点了没反应），
  // 再请主进程滚动 + 高亮。输入框的磁贴有一份等价逻辑——**故意不抽公共 helper**：
  // 那会为了让气泡回显去改一个与本次请求无关的文件，而这里是 3 行、不构成重复负担。
  const reveal = (selector: string) => {
    const store = useAppStore.getState();
    if (store.rightPanelMode !== "browser") store.toggleBrowserPanel();
    void window.electronAPI?.browser?.picker?.highlight(selector);
  };
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {selections.map((selection) => {
        const label = `${selection.tag}${
          selection.classes.length ? `.${selection.classes[0]}` : ""
        }`;
        return (
          // title 挂包裹元素而不是 button：仓库禁止 <button title>
          <span
            key={`${selection.pageUrl}|${selection.selector}`}
            title={selection.selector}
            className="inline-flex"
          >
            <button
              type="button"
              onClick={() => reveal(selection.selector)}
              aria-label={t("elementRef.reveal")}
              className="inline-flex max-w-[18rem] items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <MousePointerSquareDashed className="h-3 w-3 shrink-0" />
              <span className="truncate">{label}</span>
              {selection.text ? (
                <span className="truncate text-text-muted">
                  {selection.text}
                </span>
              ) : null}
              {selection.selectorUnique ? null : (
                <span className="shrink-0 rounded bg-surface px-1 text-[10px] text-text-muted">
                  {t("attachTile.notUnique")}
                </span>
              )}
            </button>
          </span>
        );
      })}
    </div>
  );
}
