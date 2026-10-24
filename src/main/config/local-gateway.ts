/**
 * @module main/config/local-gateway
 *
 * 本机 AI 网关（目前只有 Magpie）的一次性探测。只回答「端口通不通」，
 * 不做重试/轮询，也不发聊天请求。
 */
import net from "node:net";
import {
  getLocalGatewayPreset,
  type LocalGatewayProbeResult,
} from "../../shared/local-gateways";
import { normalizeOpenAICompatibleBaseUrl } from "./auth-utils";

export interface LocalGatewayProbeInput {
  baseUrl?: string;
  apiKey?: string;
}

export interface LocalGatewayProbeDeps {
  connectTcp?: (
    host: string,
    port: number,
    timeoutMs: number,
  ) => Promise<boolean>;
  fetchImpl?: typeof fetch;
}

const TCP_TIMEOUT_MS = 800;
const HTTP_TIMEOUT_MS = 1500;

function defaultConnectTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function probeLocalGateway(
  input: LocalGatewayProbeInput = {},
  deps: LocalGatewayProbeDeps = {},
): Promise<LocalGatewayProbeResult> {
  const preset = getLocalGatewayPreset("magpie");
  const normalized = normalizeOpenAICompatibleBaseUrl(input.baseUrl?.trim());
  const baseUrl = normalized || preset?.baseUrl || "";
  if (!baseUrl) return { available: false };

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { available: false };
  }

  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const reachable = await (deps.connectTcp ?? defaultConnectTcp)(
    host,
    port,
    TCP_TIMEOUT_MS,
  ).catch(() => false);
  if (!reachable) return { available: false };

  const apiKey = input.apiKey?.trim();
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const response = await (deps.fetchImpl ?? fetch)(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    // 任意 HTTP 状态都说明服务在跑；鉴权/聚合问题留给连接流程报。
    if (!response.ok) return { available: true };
    const payload: unknown = await response.json();
    const data = (payload as { data?: unknown } | null)?.data;
    return Array.isArray(data)
      ? { available: true, modelCount: data.length }
      : { available: true };
  } catch {
    // TCP 通了但 /models 超时或解析失败：服务仍在跑。
    return { available: true };
  }
}
