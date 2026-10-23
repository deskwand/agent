import type {
  QuotaSnapshot,
  QuotaWindow,
  QuotaWindowKind,
} from "../../shared/quota";
import { log } from "../utils/logger";

export const OPENCODE_GO_PROVIDER_ID = "opencode-go";
export const OPENCODE_GO_PROVIDER_NAME = "OpenCode Go";

/**
 * Go 用量端点：与 profile 预设同源（api-model-presets 的 opencode-go baseUrl
 * 是 `https://opencode.ai/inference/go/v1`）。旧的 zen 路径
 * `/zen/go/v1/usage` 实测返回同一份数据。
 */
const USAGE_URL = "https://opencode.ai/inference/go/v1/usage";
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * 已用百分比：有限且非负即收，**不设 100 上界**。
 *
 * Go 的 Extra usage 允许套餐用尽后回落按量余额继续跑，此时接口可能回报 >100；
 * 若照 Codex 的 0-100 校验丢弃该窗口，用户恰好在最该看到数字时整行消失。
 * 进度条不会因此溢出 —— `AppProgress` 内部已把百分比夹到 0-100。
 */
function readPercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** resetsAt 是 ISO 字符串；解析不出来的当缺失，该副行不渲染。 */
function readResetsAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readWindow(
  value: unknown,
  kind: QuotaWindowKind,
): QuotaWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const usedPercent = readPercent(record.percent);
  if (usedPercent === undefined) return undefined;
  const resetsAt = readResetsAt(record.resetsAt);
  return resetsAt === undefined
    ? { kind, usedPercent }
    : { kind, usedPercent, resetsAt };
}

/** 按 5h → 7d → 月度 排；缺哪个少哪条，三窗口全缺则整体作废。 */
function parseUsagePayload(payload: unknown): QuotaWindow[] | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const usage =
    root.usage && typeof root.usage === "object"
      ? (root.usage as Record<string, unknown>)
      : {};
  const windows = [
    readWindow(usage.rolling, "session"),
    readWindow(usage.weekly, "weekly"),
    readWindow(usage.monthly, "monthly"),
  ].filter((window): window is QuotaWindow => window !== undefined);
  return windows.length > 0 ? windows : null;
}

/**
 * 拉一次 OpenCode Go 订阅额度。
 *
 * token 由调用方注入（凭据解析留在 index.ts），因此本文件不依赖 Electron，可直接单测。
 * `status` 字段本期不用；任何失败一律返回 null 并记日志 —— 额度接口挂了不该让弹层报错。
 */
export async function fetchOpenCodeGoQuota(
  token: string,
): Promise<QuotaSnapshot | null> {
  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // Go 文档要求客户端自带可识别标识，而不是通用 SDK / HTTP 库名。
        "User-Agent": "deskwand",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    log("[Quota] OpenCode Go usage 请求失败:", error);
    return null;
  }

  if (!response.ok) {
    log("[Quota] OpenCode Go usage 返回非 2xx:", response.status);
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    log("[Quota] OpenCode Go usage 响应不是 JSON");
    return null;
  }

  const windows = parseUsagePayload(payload);
  if (!windows) {
    log("[Quota] OpenCode Go usage 没有可用窗口");
    return null;
  }

  return {
    providerId: OPENCODE_GO_PROVIDER_ID,
    providerName: OPENCODE_GO_PROVIDER_NAME,
    windows,
  };
}
