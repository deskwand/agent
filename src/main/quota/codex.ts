import type {
  QuotaSnapshot,
  QuotaWindow,
  QuotaWindowKind,
} from "../../shared/quota";
import { log } from "../utils/logger";

export const CODEX_PROVIDER_ID = "openai-codex";
export const CODEX_PROVIDER_NAME = "OpenAI Codex";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
/** pi-ai 同款 claim 路径（dist/auth/oauth/openai-codex.js:35）。 */
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * 从 access token 解 JWT claim 取 accountId。
 *
 * 必须从**即将发送的这枚 token** 里取，不能读 auth.json 里存的那个 accountId：
 * 那是第二个真相来源，SDK 刷新 token 后可能与新 token 不一致（设计文档 §3.3）。
 */
function extractAccountId(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as Record<string, unknown>;
    const auth = payload[JWT_CLAIM_PATH];
    if (!auth || typeof auth !== "object") return undefined;
    const value = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** 严格取百分比：必须是 0-100 的有限数字，否则当缺失。猜出来的百分比是错误数据。 */
function readPercent(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : undefined;
}

/** reset_at 是 Unix 秒；不是有限数字就当缺失。 */
function readResetsAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value * 1000
    : undefined;
}

function readWindow(
  value: unknown,
  kind: QuotaWindowKind,
): QuotaWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const usedPercent = readPercent(record.used_percent);
  if (usedPercent === undefined) return undefined;
  const resetsAt = readResetsAt(record.reset_at);
  return resetsAt === undefined
    ? { kind, usedPercent }
    : { kind, usedPercent, resetsAt };
}

/** 按字段尽力而为：缺哪个窗口就少哪一条，两个都缺则整体作废。 */
function parseUsagePayload(
  payload: unknown,
): { planName?: string; windows: QuotaWindow[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const rateLimit =
    root.rate_limit && typeof root.rate_limit === "object"
      ? (root.rate_limit as Record<string, unknown>)
      : {};
  const windows: QuotaWindow[] = [];
  const session = readWindow(rateLimit.primary_window, "session");
  const weekly = readWindow(rateLimit.secondary_window, "weekly");
  if (session) windows.push(session);
  if (weekly) windows.push(weekly);
  if (windows.length === 0) return null;

  const planName =
    typeof root.plan_type === "string" && root.plan_type.length > 0
      ? root.plan_type
      : undefined;
  return planName === undefined ? { windows } : { planName, windows };
}

/**
 * 拉一次 Codex 订阅额度。
 *
 * token 由调用方注入（凭据解析留在 index.ts），因此本文件不依赖 Electron，可直接单测。
 * 任何失败一律返回 null 并记日志 —— 额度接口挂了不该让输入框旁的弹层报错。
 */
export async function fetchCodexQuota(
  token: string,
): Promise<QuotaSnapshot | null> {
  const accountId = extractAccountId(token);
  if (!accountId) {
    log("[Quota] Codex token 里没有 chatgpt_account_id，跳过额度查询");
    return null;
  }

  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "ChatGPT-Account-Id": accountId,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    log("[Quota] Codex usage 请求失败:", error);
    return null;
  }

  if (!response.ok) {
    log("[Quota] Codex usage 返回非 2xx:", response.status);
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    log("[Quota] Codex usage 响应不是 JSON");
    return null;
  }

  const parsed = parseUsagePayload(payload);
  if (!parsed) {
    log("[Quota] Codex usage 没有可用窗口");
    return null;
  }

  return {
    providerId: CODEX_PROVIDER_ID,
    providerName: CODEX_PROVIDER_NAME,
    ...parsed,
  };
}
