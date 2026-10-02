import type { ApiProviderModel, ProviderModelInfo } from "../types";

/** 一行可勾选的模型。`isNew` 表示"端点这次返回、目录里没有"，UI 上给「新增」徽章。 */
export interface ProviderModelRow {
  id: string;
  label: string;
  isNew: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
  enabled: boolean;
  isDefault: boolean;
}

export interface MergeProviderModelsInput {
  /** 由 `config.getPresets()` 得到的目录；自定义供应商传空数组 */
  catalog: Array<{ id: string; name: string }>;
  /** 本次从端点拉到的列表；null = 没拿到（失败 / 端点不支持） */
  live: ProviderModelInfo[] | null;
  /** 当前已启用的模型（编辑既有供应商时传入） */
  saved: ApiProviderModel[];
  /** 用户取消勾选过的 id（`disabledModels`） */
  disabled: string[];
  defaultModel: string;
  modelSource: ApiProviderModel["source"];
}

export interface MergeProviderModelsResult {
  rows: ProviderModelRow[];
  enabled: ApiProviderModel[];
  defaultModel: string;
  disabled: string[];
}

function withMetadata(
  base: ApiProviderModel,
  row: ProviderModelRow,
): ApiProviderModel {
  const model: ApiProviderModel = { ...base };
  if (typeof row.contextWindow === "number" && row.contextWindow > 0) {
    model.contextWindow = Math.round(row.contextWindow);
  }
  if (typeof row.maxTokens === "number" && row.maxTokens > 0) {
    model.maxTokens = Math.round(row.maxTokens);
  }
  if (Array.isArray(row.input) && row.input.length > 0) {
    model.input = row.input;
  }
  return model;
}

function blankRow(
  id: string,
  label: string,
  extra: Partial<ProviderModelRow>,
): ProviderModelRow {
  return {
    id,
    label: label.trim() || id,
    isNew: false,
    enabled: false,
    isDefault: false,
    ...extra,
  };
}

export function mergeProviderModels(
  input: MergeProviderModelsInput,
): MergeProviderModelsResult {
  const disabled = new Set(input.disabled.filter(Boolean));
  const savedById = new Map(input.saved.map((model) => [model.id, model]));
  const liveById = new Map(
    (input.live ?? []).map((model) => [model.id, model]),
  );
  const known = new Set<string>();
  const rows: ProviderModelRow[] = [];

  // 1) 目录在前，顺序沿用目录（预设供应商的目录已按 id 排过序）
  for (const item of input.catalog) {
    if (known.has(item.id)) continue;
    known.add(item.id);
    const saved = savedById.get(item.id);
    rows.push(
      blankRow(item.id, item.name, {
        enabled: !disabled.has(item.id),
        contextWindow: saved?.contextWindow,
        maxTokens: saved?.maxTokens,
        input: saved?.input,
      }),
    );
  }

  // 2) 端点独有的追加在末尾，按 id 排序，标「新增」
  const liveOnly = Array.from(liveById.values())
    .filter((model) => !known.has(model.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const model of liveOnly) {
    known.add(model.id);
    rows.push(
      blankRow(model.id, model.name, {
        isNew: true,
        enabled: !disabled.has(model.id),
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
      }),
    );
  }

  // 3) 本地已有、但目录与端点都没有的：保留并保持启用
  const savedOnly = input.saved
    .filter((model) => !known.has(model.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const model of savedOnly) {
    known.add(model.id);
    rows.push(
      blankRow(model.id, model.label, {
        enabled: true,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
      }),
    );
  }

  // 4) 清理 disabled：目录与端点都不认的 id 丢掉
  const catalogIds = new Set(input.catalog.map((item) => item.id));
  const liveIds = new Set(liveById.keys());
  const nextDisabled = Array.from(disabled).filter(
    (id) => catalogIds.has(id) || liveIds.has(id),
  );

  // 5) 默认模型：原值仍启用则保留，否则取第一个启用行
  const enabledRows = rows.filter((row) => row.enabled);
  const defaultModel =
    input.defaultModel &&
    enabledRows.some((row) => row.id === input.defaultModel)
      ? input.defaultModel
      : (enabledRows[0]?.id ?? "");
  for (const row of rows) {
    row.isDefault = row.id === defaultModel;
  }

  // 6) 输出启用集
  const enabled: ApiProviderModel[] = enabledRows.map((row) =>
    withMetadata(
      { id: row.id, label: row.label, source: input.modelSource },
      row,
    ),
  );

  return { rows, enabled, defaultModel, disabled: nextDisabled };
}
