/**
 * `verify:catalog` 的阶梯实现。**只报告，不改源码** —— `verified` 由人写进目录。
 *
 * 两条分支，按条目的授权形态二选一：
 *  - OAuth：L1 元数据 → L2 真发一次 DCR 注册 → L3 授权 URL 被接受
 *  - 免认证：L2′ initialize + tools/list → L3′ 真调一次只读工具
 *
 * ⚠️ L2 会**真的在厂商侧登记一个 OAuth client**（无害、无法也不需要清理）。
 * ⚠️ 默认模式（未设 `VERIFY_CATALOG=1`）下一次网络请求都不发：本模块只被测试导入。
 */
import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  type OAuthClientInformationFull,
  type OAuthServerInfo,
} from "@earendil-works/pi-mcp/oauth";
import type { McpFetch } from "@earendil-works/pi-mcp";

export interface VerifyResult {
  level: "none" | "metadata" | "registered";
  registration: boolean;
  authUrlAccepted: boolean;
  detail: string;
}

function emptyResult(): VerifyResult {
  return {
    level: "none",
    registration: false,
    authUrlAccepted: false,
    detail: "",
  };
}

/** RFC 9728 的元数据路径有「带资源路径」与「不带」两种写法，逐个试。
 *  取不到就返回 null —— 探测工具不该因为一个 404 或网络错误就炸掉整轮。 */
const REDIRECT_URL = "http://127.0.0.1/callback";

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function verifyEndpoint(
  url: string,
  f: typeof fetch,
): Promise<VerifyResult> {
  const out = emptyResult();
  const mcpFetch = f as unknown as McpFetch;

  // L1：发现。用 SDK 自己的实现，而不是手抄一份协议 ——
  // 手写会在「SDK 实际发了什么」和「工具发了什么」之间漂移，Framer 那次
  // （注册漏 scope）就是这类漂移，而且漂移方向可能是**假阳性**，比假阴性更危险。
  let info: OAuthServerInfo;
  try {
    info = await discoverOAuthServerInfo(url, { fetch: mcpFetch });
  } catch (e) {
    out.detail = `discovery failed: ${messageOf(e)}`;
    return out;
  }
  const metadata = info.authorizationServerMetadata;
  if (!metadata) {
    out.detail = "no authorization-server metadata";
    return out;
  }
  out.level = "metadata";
  if (!metadata.registration_endpoint) {
    out.detail = "no registration_endpoint (needs a pre-registered clientId)";
    return out;
  }

  // scope 的取值与 SDK 一致（flow.js:153）：
  // `options.scope ?? resourceMetadata.scopes_supported.join(" ") ?? clientMetadata.scope`
  const scope = info.resourceMetadata?.scopes_supported?.join(" ");

  // L2：真的注册一次。clientMetadata 的默认值对齐 `McpOAuthProvider`。
  let client: OAuthClientInformationFull;
  try {
    client = await registerClient(info.authorizationServerUrl, {
      metadata,
      clientMetadata: {
        client_name: "DeskWand catalog verification",
        redirect_uris: [REDIRECT_URL],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(scope ? { scope } : {}),
      },
      scope,
      fetch: mcpFetch,
    });
  } catch (e) {
    out.detail = `registration failed: ${messageOf(e)}`;
    return out;
  }
  out.registration = true;

  // L3：构造授权 URL（SDK 会带上 resource / scope / state / PKCE，
  // 并先检查 response_types 与 S256 是否被支持）后真的请求它。
  let authorizationUrl: URL;
  try {
    ({ authorizationUrl } = await startAuthorization(
      info.authorizationServerUrl,
      {
        metadata,
        clientInformation: client,
        redirectUrl: REDIRECT_URL,
        scope,
        // state 必须对齐 app：`McpOAuthProvider.state()` 用 32 字节随机数的 hex。
        // 随便编一个短字符串会被某些厂商（Attio）以 invalid_request 拒掉 —— 那是
        // 工具的假阴性，不是产品的缺陷。
        state: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
          "hex",
        ),
      },
    ));
  } catch (e) {
    out.detail = `authorize URL could not be built: ${messageOf(e)}`;
    return out;
  }

  const res = await f(authorizationUrl.toString(), {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  const body = (await res.text().catch(() => "")).slice(0, 300);
  const bodyError =
    /"error"\s*:\s*"[^"]+"|invalid_client|unauthorized_client|invalid_request/.test(
      body,
    );
  // 必须**显式**是成功码：把 404 / 500 当成「授权 URL 被接受」会让工具给出假阳性。
  out.authUrlAccepted = res.status < 400 && !bodyError;
  if (!out.authUrlAccepted) {
    out.detail = `authorize URL rejected (HTTP ${res.status}): ${body.replace(/\s+/g, " ").slice(0, 160)}`;
    return out;
  }

  out.level = "registered";
  out.detail = "DCR + authorize URL accepted";
  return out;
}

/** 免认证分支：initialize → tools/list → 真调一次只读工具。
 *  `tools/list` 公开 ≠ 能用（Gmail 就是反例），所以必须走到 L3′。 */
export async function verifyOpenEndpoint(
  url: string,
  f: typeof fetch,
): Promise<VerifyResult> {
  const out = emptyResult();
  const call = async (method: string, params: unknown, id: number) => {
    try {
      const res = await f(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      const text = await res.text().catch(() => "");
      const line = text.split("\n").find((l) => l.startsWith("data: "));
      try {
        return {
          status: res.status,
          json: JSON.parse(line ? line.slice(6) : text) as Record<
            string,
            unknown
          >,
        };
      } catch {
        return {
          status: res.status,
          json: null as Record<string, unknown> | null,
        };
      }
    } catch {
      return { status: 0, json: null as Record<string, unknown> | null };
    }
  };

  const init = await call(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "deskwand-verify", version: "1" },
    },
    1,
  );
  if (init.status !== 200 || !init.json?.result) {
    out.detail = `initialize HTTP ${init.status}（需要凭据，不是免认证）`;
    return out;
  }
  out.level = "metadata";

  const list = await call("tools/list", {}, 2);
  const tools = (
    list.json?.result as { tools?: Array<{ name: string }> } | undefined
  )?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    out.detail = "tools/list 没有返回工具";
    return out;
  }

  const readTool = tools.find((t) => /read|list|search|get/i.test(t.name));
  if (!readTool) {
    out.detail = `有 ${tools.length} 个工具，但没有识别出只读工具，无法验证 L3′`;
    return out;
  }
  const called = await call(
    "tools/call",
    { name: readTool.name, arguments: {} },
    3,
  );
  const content = (
    called.json?.result as { content?: Array<{ text?: string }> }
  )?.content;
  const gotData =
    Array.isArray(content) && content.some((c) => (c.text ?? "").length > 0);
  if (!gotData) {
    out.detail = `只读工具 ${readTool.name} 调用没有返回数据`;
    return out;
  }
  out.level = "registered";
  out.detail = `tools/list ${tools.length} + ${readTool.name} 返回数据`;
  return out;
}
