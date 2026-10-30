import { Plus, Search, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderModelRow } from "../../../utils/merge-provider-models";
import { Button } from "../../app-button";
import { Input } from "../../ui/input";

export interface ProviderModelListProps {
  rows: ProviderModelRow[];
  /** 自定义 / 本机 / 端点无列表时为 true：出现手工行与「添加模型」 */
  allowManual: boolean;
  onChange: (rows: ProviderModelRow[]) => void;
  /** 行编辑提交（失焦 / 面板关闭）→ 落盘 */
  onCommit: (rows: ProviderModelRow[]) => void;
}

function formatContextWindow(value: number | undefined): string | undefined {
  if (!value || value <= 0) return undefined;
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

/**
 * 模型列表：一行四元素（勾选 · 名称 · 能力 chip · 默认）。
 * 上下文与图片能力收进 chip 打开的 popover，行本身不再堆七件控件。
 */
export function ProviderModelList({
  rows,
  allowManual,
  onChange,
  onCommit,
}: ProviderModelListProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [openCapability, setOpenCapability] = useState<string | null>(null);
  // 输入过程中的最后一次补丁：失焦时提交它，而不是 props 里的旧 rows
  const lastPatched = useRef<ProviderModelRow[] | null>(null);

  const needle = filter.trim().toLowerCase();
  const visible = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        !needle ||
        row.id.toLowerCase().includes(needle) ||
        row.label.toLowerCase().includes(needle),
    );

  const enabledCount = rows.filter(
    (row) => row.enabled && row.id.trim(),
  ).length;
  const totalCount = rows.filter((row) => row.id.trim()).length;

  /** 返回补丁后的整列表：onCommit 必须拿到同一份，不能用闭包里的旧 rows。 */
  const patch = (
    index: number,
    next: Partial<ProviderModelRow>,
  ): ProviderModelRow[] => {
    const patched = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...next } : row,
    );
    onChange(patched);
    return patched;
  };

  /** 勾选切换：至少保留一个启用模型。 */
  const toggleEnabled = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.enabled && enabledCount <= 1) return;
    const next = rows.map((item, rowIndex) =>
      rowIndex === index ? { ...item, enabled: !item.enabled } : item,
    );
    onChange(next);
    onCommit(next);
  };

  const setDefault = (index: number) => {
    const next = rows.map((item, rowIndex) => ({
      ...item,
      isDefault: rowIndex === index,
    }));
    onChange(next);
    onCommit(next);
  };

  const addRow = () => {
    onChange([
      ...rows,
      {
        id: "",
        label: "",
        isNew: true,
        enabled: true,
        isDefault: rows.length === 0,
        manual: true,
      },
    ]);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange(next);
    onCommit(next);
  };

  const imageOn = (row: ProviderModelRow) =>
    row.input?.includes("image") ?? false;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          {t("api.modelsSection")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("api.modelsEnabledCount", {
            enabled: enabledCount,
            total: totalCount,
          })}
        </span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-testid="model-search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("api.modelsSearch")}
          className="h-auto w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs shadow-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </div>

      {rows.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {allowManual ? t("api.modelsManualHint") : t("api.modelsFetchHint")}
        </p>
      )}

      <div data-testid="model-rows" className="space-y-0.5">
        {visible.map(({ row, index }) => {
          const chip = [formatContextWindow(row.contextWindow)]
            .filter(Boolean)
            .concat(
              imageOn(row)
                ? t("api.modelCapabilityChipImage")
                : t("api.modelCapabilityChipText"),
            )
            .join(" · ");
          const panelOpen = openCapability === (row.id || `manual-${index}`);
          const panelKey = row.id || `manual-${index}`;
          return (
            <div key={`${panelKey}-${index}`} className="rounded-lg">
              <div className="flex items-center gap-2 px-1 py-1.5 hover:bg-hover-surface">
                <input
                  type="checkbox"
                  data-testid={`model-row-${row.id}`}
                  checked={row.enabled}
                  onChange={() => toggleEnabled(index)}
                  className="flex-none rounded"
                />
                {row.manual || !row.id ? (
                  <Input
                    type="text"
                    value={row.id}
                    placeholder={t("api.modelId")}
                    data-testid={`model-id-${index}`}
                    onChange={(event) => {
                      lastPatched.current = patch(index, {
                        id: event.target.value,
                        label: event.target.value,
                      });
                    }}
                    onBlur={() => onCommit(lastPatched.current ?? rows)}
                    className="h-auto min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground shadow-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {row.label || row.id}
                  </span>
                )}
                <button
                  type="button"
                  data-testid={`model-capability-${row.id}`}
                  aria-expanded={panelOpen}
                  onClick={() => setOpenCapability(panelOpen ? null : panelKey)}
                  className="flex-none rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-hover-surface hover:text-foreground"
                >
                  {chip}
                </button>
                <button
                  type="button"
                  onClick={() => setDefault(index)}
                  disabled={!row.enabled || !row.id.trim()}
                  className={`flex-none rounded-md border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
                    row.isDefault
                      ? "border-primary bg-primary/10 font-medium text-primary-text"
                      : "border-border/60 text-muted-foreground hover:border-border"
                  }`}
                >
                  {t("api.modelsDefault")}
                </button>
                {allowManual && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label={t("common.delete")}
                    className="h-auto flex-none rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {panelOpen && (
                <div
                  data-testid={`model-capability-panel-${row.id}`}
                  className="mb-1 ml-6 space-y-3 rounded-lg border border-border/60 bg-background px-3 py-2.5"
                >
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      {t("api.modelCapabilityContext")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={row.contextWindow ?? ""}
                        data-testid={`model-context-${row.id}`}
                        placeholder={t("api.contextWindowPlaceholder")}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          lastPatched.current = patch(index, {
                            contextWindow:
                              event.target.value && parsed > 0
                                ? Math.round(parsed)
                                : undefined,
                            contextWindowPinned: Boolean(
                              event.target.value && parsed > 0,
                            ),
                          });
                        }}
                        onBlur={() => onCommit(lastPatched.current ?? rows)}
                        className="h-auto w-32 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <Button
                        variant="ghost"
                        type="button"
                        data-testid={`model-capability-reset-${row.id}`}
                        onClick={() => {
                          onCommit(
                            patch(index, {
                              contextWindow: undefined,
                              contextWindowPinned: false,
                            }),
                          );
                        }}
                        className="h-auto rounded-lg border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-hover-surface hover:text-foreground"
                      >
                        {t("api.modelCapabilityReset")}
                      </Button>
                    </div>
                    <p className="text-[10.5px] text-muted-foreground">
                      {t("api.modelCapabilityAutoHint")}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      {t("api.supportsImage")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {(["auto", "on", "off"] as const).map((mode) => {
                        const active =
                          mode === "on"
                            ? row.inputPinned && imageOn(row)
                            : mode === "off"
                              ? row.inputPinned && !imageOn(row)
                              : !row.inputPinned;
                        return (
                          <Button
                            variant="ghost"
                            key={mode}
                            type="button"
                            data-testid={`model-image-${mode}-${row.id}`}
                            onClick={() => {
                              const next: Partial<ProviderModelRow> =
                                mode === "auto"
                                  ? {
                                      input: undefined,
                                      inputPinned: false,
                                    }
                                  : mode === "on"
                                    ? {
                                        input: ["text", "image"] as const,
                                        inputPinned: true,
                                      }
                                    : {
                                        input: ["text"] as const,
                                        inputPinned: true,
                                      };
                              onCommit(patch(index, next));
                            }}
                            className={`h-auto rounded-md border px-2 py-0.5 text-[11px] ${
                              active
                                ? "border-primary bg-primary/10 font-medium text-primary-text"
                                : "border-border/60 text-muted-foreground hover:border-border"
                            }`}
                          >
                            {mode === "auto"
                              ? t("api.modelCapabilityAutomatic")
                              : mode === "on"
                                ? t("api.modelCapabilityImageOn")
                                : t("api.modelCapabilityImageOff")}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allowManual && (
        <Button
          variant="ghost"
          type="button"
          data-testid="model-add-row"
          onClick={addRow}
          className="inline-flex h-auto items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          {t("api.addCustomModel")}
        </Button>
      )}
    </div>
  );
}
