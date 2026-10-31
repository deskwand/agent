/**
 * 供应商「连接 + 落盘」的共同路径。
 *
 * 设置页的添加/编辑与欢迎屏的「粘贴 API Key」必须走同一条判断链
 * （预写目录 → 诊断 → 合并 → 写回模型），否则两处的模型列表口径会漂。
 * 这里只做流程，不持状态：状态由调用方用 deps 回调接管。
 */
import { mergeProviderModels } from "../utils/merge-provider-models";
import type { MergeProviderModelsResult } from "../utils/merge-provider-models";
import { ConnectTimeoutError, diagnoseProviderModels } from "./connect-models";
import type {
  ApiProviderModel,
  AppConfig,
  DiagnosticResult,
  ProviderDraft,
  ProviderPresets,
  ProviderType,
  CustomProtocolType,
  SaveProviderPayload,
} from "../types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** 模型集写回：与设置页的 persistModels 同一份 payload 组装。 */
export async function persistProviderModels(
  draft: ProviderDraft,
  models: ApiProviderModel[],
  defaultModel: string,
  disabledModels: string[],
): Promise<AppConfig> {
  if (!window.electronAPI) throw new Error("electronAPI unavailable");
  const payload: SaveProviderPayload = {
    profileKey: draft.profileKey,
    config: {
      provider: draft.provider,
      customProtocol: draft.customProtocol,
      name: draft.name || undefined,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl,
      defaultModel,
      models,
      ...(disabledModels.length > 0 ? { disabledModels } : {}),
      ...(draft.localGateway ? { localGateway: draft.localGateway } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
  const saved = await window.electronAPI.config.saveProvider(payload);
  return saved.config;
}

export interface ConnectProviderDeps {
  t: Translate;
  /** 该 profile 是否已落过盘（编辑已有供应商时不预写，免得把模型洗回目录） */
  isSaved: (profileKey: string) => boolean;
  /** 写回模型集，返回是否成功 */
  persist: (
    draft: ProviderDraft,
    models: ApiProviderModel[],
    defaultModel: string,
    disabled: string[],
  ) => Promise<boolean>;
  /** 合并结果写回草稿 */
  onMerge: (merge: MergeProviderModelsResult, draft: ProviderDraft) => void;
  /**
   * 判定本轮请求是否已作废（用户关掉了页面 / 换了草稿）。
   * 返回 true 时后续写入全部丢弃。
   */
  isStale?: () => boolean;
  /** 打开已有供应商时的静默刷新：失败只留一行提示，不当成连接失败 */
  silent?: boolean;
  onDiagnostic?: (result: DiagnosticResult) => void;
  onState?: (state: "connecting" | "connected" | "failed" | "idle") => void;
  onMessage?: (message: string) => void;
  onError?: (message: string) => void;
}

/** 需要用户填 key 的供应商类型（OAuth 走登录，不走这条路径）。 */
export function requiresApiKey(provider: ProviderType): boolean {
  return provider !== "oauth";
}

export interface ConnectProviderContext {
  draft: ProviderDraft;
  presets: ProviderPresets;
  /** 预设供应商的内置目录；自定义 / OAuth 传空数组 */
  catalog?: Array<{ id: string; name?: string }>;
}

/**
 * 连接一个供应商并落盘。
 * 返回 true = 连上且可用模型已写回；false = 失败（原因已通过 deps 回调给出）。
 */
export async function connectAndPersistProvider(
  context: ConnectProviderContext,
  deps: ConnectProviderDeps,
): Promise<boolean> {
  if (!window.electronAPI) return false;
  const { draft } = context;
  const catalog = context.catalog ?? [];
  const { t, isSaved, persist, onMerge } = deps;
  const isStale = deps.isStale ?? (() => false);
  const silent = deps.silent ?? false;
  const isCustom = draft.provider === "custom";
  const alreadySaved = isSaved(draft.profileKey);

  const fail = (message?: string): false => {
    if (isStale()) return false;
    if (silent) {
      deps.onMessage?.(message ?? t("api.modelsRefreshFailed"));
      deps.onState?.("idle");
      return false;
    }
    if (message) deps.onMessage?.(message);
    deps.onState?.("failed");
    return false;
  };

  if (requiresApiKey(draft.provider) && !draft.apiKey) {
    deps.onError?.(t("api.enterApiKey"));
    return false;
  }
  if (isCustom && !draft.baseUrl) {
    deps.onError?.(t("api.enterBaseUrl"));
    return false;
  }

  deps.onError?.("");
  deps.onMessage?.("");
  deps.onDiagnostic?.(null as unknown as DiagnosticResult);
  deps.onState?.("connecting");

  // 预设供应商先落盘（目录兜底，断网也可用）；自定义供应商等拉取成功再落盘。
  if (!isCustom && !alreadySaved) {
    const savedFirst = await persist(
      draft,
      [],
      draft.defaultModel,
      draft.disabledModels ?? [],
    );
    if (isStale()) return false;
    if (!savedFirst) {
      deps.onState?.("idle");
      return false;
    }
  }

  let result: DiagnosticResult;
  try {
    result = await diagnoseProviderModels({
      provider: draft.provider as ProviderType,
      apiKey: draft.apiKey,
      baseUrl: isCustom ? draft.baseUrl : undefined,
      customProtocol: draft.customProtocol as CustomProtocolType,
      captureModels: true,
    });
  } catch (connectError) {
    return fail(
      connectError instanceof ConnectTimeoutError
        ? t("api.connectTimeout")
        : connectError instanceof Error
          ? connectError.message
          : String(connectError),
    );
  }

  if (isStale()) return false;
  deps.onDiagnostic?.(result);

  if (result.skippedReason) return fail(t("api.modelsBusy"));
  if (!result.overallOk) {
    return fail(
      draft.localGateway && result.failedAt === "auth"
        ? t("api.localGatewayAuthFailed")
        : undefined,
    );
  }

  const live = result.modelsSource === "live" ? (result.models ?? []) : null;
  // 空列表等同于「没拿到」：既不报成功，也不拿它去合并清空草稿。
  if (isCustom && live !== null && live.length === 0) {
    return fail(
      draft.localGateway
        ? t("api.localGatewayNoModels")
        : t("api.modelsManualHint"),
    );
  }

  const merge = mergeProviderModels({
    catalog: catalog.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
    })),
    live,
    saved: draft.models,
    disabled: draft.disabledModels ?? [],
    defaultModel: draft.defaultModel,
    modelSource: isCustom ? "custom" : "preset",
    // 静默刷新只刷元数据；只有显式重连才把端点没返回的模型当作下线删掉
    dropMissingModels: !silent,
  });
  onMerge(merge, draft);

  if (isCustom && (!live || merge.enabled.length === 0)) {
    return fail(
      draft.localGateway && live
        ? t("api.localGatewayNoModels")
        : t("api.modelsManualHint"),
    );
  }

  // 预设供应商一个可用模型都没有 = 没配上（目录兜底也空），不能报成功
  if (merge.enabled.length === 0) {
    return fail(
      draft.localGateway
        ? t("api.localGatewayNoModels")
        : t("api.modelsManualHint"),
    );
  }

  if (merge.enabled.length > 0) {
    const persisted = await persist(
      draft,
      merge.enabled,
      merge.defaultModel,
      merge.disabled,
    );
    if (!persisted) return fail();
  }

  deps.onState?.("connected");
  if (result.modelsSource === "unsupported") {
    deps.onMessage?.(t("api.modelsUnsupported"));
  } else if (result.modelsFiltered) {
    deps.onMessage?.(t("api.modelsFiltered", { count: result.modelsFiltered }));
  } else {
    deps.onMessage?.(t("api.connected"));
  }
  return true;
}
