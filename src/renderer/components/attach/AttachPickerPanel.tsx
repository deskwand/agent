import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Loader2, Search } from "lucide-react";
import { FileTypeIcon } from "../file-type-icon";
import { getFileKind } from "../../utils/file-types";
import { filterPickerItems, type AttachPickerItem } from "./picker-items";

export interface AttachPickerPanelProps {
  /** 数据源标识，用于拼「已添加」的 key（与附件身份 key 同构） */
  source: "vault" | "workspace";
  items: AttachPickerItem[];
  loading: boolean;
  /** 数据源为空时的文案（密库为空 / 工作区为空） */
  emptyLabel: string;
  /** 空态上的可选动作，例如「去密库上传文件」 */
  emptyAction?: { label: string; onClick: () => void };
  /** 顶部提示，例如扫描被截断 */
  noticeLabel?: string;
  /** 有值时渲染错误态与重试，不透传成空列表 */
  errorLabel?: string;
  onRetry: () => void;
  /** `${source}:${item.id}` 集合 */
  addedKeys: ReadonlySet<string>;
  onConfirm: (ids: string[]) => void;
  onBack: () => void;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 密库与工作区共用的选择器骨架：搜索 + 多选勾选 + 底部确认。
 * 不感知数据源，也不拉数据——两个数据源都在 AttachMenu 里。
 */
export function AttachPickerPanel({
  source,
  items,
  loading,
  emptyLabel,
  emptyAction,
  noticeLabel,
  errorLabel,
  onRetry,
  addedKeys,
  onConfirm,
  onBack,
  onClose,
}: AttachPickerPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const visible = useMemo(() => filterPickerItems(items, query), [items, query]);
  const isAdded = (id: string) => addedKeys.has(`${source}:${id}`);

  const toggle = (id: string) => {
    if (isAdded(id)) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  /** 高亮项可能因重新加载而越界，取不到就当没有高亮。 */
  const highlighted = visible[highlight];

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (query) {
        setQuery("");
        setHighlight(-1);
        return;
      }
      onClose();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (visible.length === 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((prev) => {
        const next = prev + delta;
        if (next < 0) return visible.length - 1;
        if (next >= visible.length) return 0;
        return next;
      });
      return;
    }

    // 焦点在搜索框里，空格本来是合法输入字符；只有在还没开始输入（查询为空）
    // 且已用方向键进入列表时，才把空格复用为「切换勾选」。
    if (event.key === " " && query === "" && highlighted) {
      event.preventDefault();
      toggle(highlighted.id);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (highlighted) {
        toggle(highlighted.id);
        return;
      }
      if (selectedIds.length > 0) onConfirm(selectedIds);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-1 px-1.5 pt-1.5">
        <button
          type="button"
          data-back
          aria-label={t("attachPicker.back")}
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(-1);
            }}
            placeholder={t("attachPicker.searchPlaceholder")}
            aria-label={t("attachPicker.searchPlaceholder")}
            className="h-8 w-full rounded-lg border border-border bg-transparent pl-7 pr-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
        </div>
      </div>

      {noticeLabel && (
        <p className="px-3 pb-1 pt-2 text-xs leading-relaxed text-text-muted">
          {noticeLabel}
        </p>
      )}

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("attachPicker.loading")}
          </div>
        ) : errorLabel ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <p className="text-sm text-error">{errorLabel}</p>
            <button
              type="button"
              data-retry
              onClick={onRetry}
              className="text-xs text-text-primary underline underline-offset-2"
            >
              {t("attachPicker.retry")}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
            <p className="text-sm text-text-muted">
              {query ? t("attachPicker.empty.search") : emptyLabel}
            </p>
            {query === "" && emptyAction && (
              <button
                type="button"
                data-empty-action
                onClick={emptyAction.onClick}
                className="text-xs text-text-primary underline underline-offset-2"
              >
                {emptyAction.label}
              </button>
            )}
          </div>
        ) : (
          visible.map((item, index) => {
            const added = isAdded(item.id);
            const selected = selectedIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={added}
                onDoubleClick={() => {
                  if (!added) onConfirm([item.id]);
                }}
                onClick={() => toggle(item.id)}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  added
                    ? "cursor-default opacity-50"
                    : index === highlight
                      ? "bg-surface-hover"
                      : "hover:bg-surface-hover"
                }`}
              >
                <FileTypeIcon kind={getFileKind(item.label)} size={16} />
                <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                  {item.label}
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {added ? t("attachPicker.added") : formatSize(item.size)}
                </span>
                <Check
                  className={`h-3.5 w-3.5 shrink-0 ${
                    selected ? "text-accent" : "text-transparent"
                  }`}
                />
              </button>
            );
          })
        )}
      </div>

      <div className="border-t border-border p-1.5">
        <button
          type="button"
          data-confirm
          disabled={selectedIds.length === 0}
          onClick={() => onConfirm(selectedIds)}
          className="h-8 w-full rounded-lg bg-accent text-sm font-medium text-background transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("attachPicker.addCount", { count: selectedIds.length })}
        </button>
      </div>
    </div>
  );
}
