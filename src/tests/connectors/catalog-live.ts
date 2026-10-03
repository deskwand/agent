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
  level: "none" | "metadata" | "registered" | "key-required";
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

/**
 * 三条分支共用的一次 JSON-RPC 调用。
 *
 * **必须共用**：每个分支各撑一份，改一处漏一处会让「工具发的请求」与「产品发的请求」
 * 漂移，而漂移方向可能是**假阳性**，比假阴性更危险。
 *
 * 带 session：有些服务（腾讯位置服务）要求把 initialize 返回的 `Mcp-Session-Id`
 * 在后面每个请求里带上，否则 `tools/list` 直接回 `unsupported protocol version`。
 * 工具不带这条头，就会把一个能用的端点误判成连不上。
 */
async function mcpCall(
  f: typeof fetch,
  url: string,
  method: string,
  params: unknown,
  id: number,
  sessionId?: string,
): Promise<{
  status: number;
  text: string;
  json: Record<string, unknown> | null;
  sessionId?: string;
}> {
  try {
    const res = await f(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    // 假 fetch（单测）不提供 headers，所以这里逐层判空
    const next = res.headers?.get?.("mcp-session-id") ?? sessionId;
    const text = await res.text().catch(() => "");
    // SSE 帧**不保证 `data:` 后面有空格** —— 腾讯位置服务发的是 `data:{…}`。
    // 只认 `data: `（带空格）会把一个能用的端点误判成「tools/list 没有返回工具」。
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    const payload = line ? line.replace(/^data:\s?/, "") : text;
    try {
      return {
        status: res.status,
        text,
        json: JSON.parse(payload) as Record<string, unknown>,
        sessionId: next,
      };
    } catch {
      return { status: res.status, text, json: null, sessionId: next };
    }
  } catch {
    return { status: 0, text: "", json: null, sessionId };
  }
}

/** 跟着上一个响应走的调用器 —— session id 自动带到下一个请求。 */
function sessionCaller(f: typeof fetch, url: string) {
  let session: string | undefined;
  return async (method: string, params: unknown, id: number) => {
    const res = await mcpCall(f, url, method, params, id, session);
    session = res.sessionId ?? session;
    return res;
  };
}

/**
 * 无凭据时「明确要凭据」的判据。
 *
 * 各家形态不一，实测过的四种都要认：
 *  - `401` / `403`（有道云笔记、百度智能云：initialize 就直接拒）
 *  - 纯文本 4xx（百度地图：`400 ak is required`）
 *  - JSON 业务错误码（高德：HTTP 200 + `INVALID_USER_KEY`）
 *  - JSON-RPC error / 工具 `isError`（Gitee：`-32603 … 401`）
 *
 * **不把 404 / 5xx / 网络失败算进来** —— 那些是端点不在或挂了，不是「要凭据」。
 */
const CREDENTIAL_HINT =
  /\bak\b|key|token|auth|credential|unauthor|forbidden|凭证|鉴权|未授权|授权/i;

/** 响应体本身在说凭据的事（不看状态码）。高德那种 `HTTP 200 + INVALID_USER_KEY`
 *  就是靠这一条认出来的 —— 只看状态码会把它当成一个正常的 200 响应。 */
function mentionsCredential(text: string): boolean {
  return CREDENTIAL_HINT.test(text);
}

function demandsCredentials(status: number, text: string): boolean {
  if (status === 401 || status === 403) return true;
  return status >= 400 && status < 500 && mentionsCredential(text);
}

/** 免认证分支：initialize → tools/list → 真调一次只读工具。
 *  `tools/list` 公开 ≠ 能用（Gmail 就是反例），所以必须走到 L3′。 */
export async function verifyOpenEndpoint(
  url: string,
  f: typeof fetch,
): Promise<VerifyResult> {
  const out = emptyResult();
  const call = sessionCaller(f, url);

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
  const result = called.json?.result as
    | { content?: Array<{ text?: string }>; isError?: boolean }
    | undefined;
  // **`isError` 的响应体也带内容**，把它当成「调到数据」会把「要凭据」误判成「免认证」：
  // 腾讯位置服务无 key 时返回 `{"content":[{"text":"Invalid Key"}],"isError":true}`。
  if (result?.isError) {
    out.level = "metadata";
    out.detail = `只读工具 ${readTool.name} 返回错误（isError）—— 不算免认证可用`;
    return out;
  }
  const content = result?.content;
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

/**
 * key 分支：端点活着，且不带凭据时被拒。
 *
 * 这一档**不验凭据的真假** —— 本仓没有厂商凭据，工具也没有。它能证明的是：
 * 端点还在、确实是 MCP、且确实要凭据。凭据投放方式（参数名 / 头名 / 前缀）
 * 来自厂商文档，记在 `catalog` 的 `auth` 里。
 *
 * 三种拒绝形态都算数（各家不一样，实测过）：
 *  - JSON-RPC 错误（Gitee 的 `-32603 API returned error status: 401`）
 *  - 工具返回 `isError: true`（百度地图的 `Authentication failed: APP不存在`）
 *  - 非 JSON 的鉴权报文体（智谱的 `Header中未收到Authorization参数`）
 * 反过来，**能真调到数据就不算 key 型** —— 那是免认证，应该走 L2′/L3′ 那一档，
 * 否则会把「免认证」错记成「要凭据」。
 */
export async function verifyKeyEndpoint(
  url: string,
  f: typeof fetch,
): Promise<VerifyResult> {
  const out = emptyResult();
  const call = sessionCaller(f, url);

  const init = await call(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "deskwand-verify", version: "1" },
    },
    1,
  );
  // 高德那类：initialize 就直接回业务错误码（HTTP 200，体里是 INVALID_USER_KEY）。
  // **必须先过 demandsCredentials** —— 否则一个 500 带 JSON 体、或者任何
  // 「有 json 但没 result/error」的响应都会被记成「明确要凭据」，
  // 而 verified 是写进目录的结论，假阳性比假阴性危险。
  if (
    init.json &&
    !init.json.result &&
    !init.json.error &&
    (demandsCredentials(init.status, init.text) ||
      mentionsCredential(init.text))
  ) {
    out.level = "key-required";
    out.detail = `端点拒绝无凭据请求：${init.text.replace(/\s+/g, " ").slice(0, 120)}`;
    return out;
  }
  if (init.status !== 200 || !init.json?.result) {
    // 有些服务连 initialize 都要凭据（有道云笔记 401、百度地图 400 ak is required）
    if (demandsCredentials(init.status, init.text)) {
      out.level = "key-required";
      out.detail = `端点拒绝无凭据请求：HTTP ${init.status} ${init.text
        .replace(/\s+/g, " ")
        .slice(0, 100)}`;
      return out;
    }
    out.detail = `initialize HTTP ${init.status}（端点不可达或无 MCP 响应）`;
    return out;
  }

  const list = await call("tools/list", {}, 2);
  const tools = (
    list.json?.result as { tools?: Array<{ name: string }> } | undefined
  )?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    out.detail = "tools/list 没有返回工具";
    return out;
  }

  const probeTool = tools.find((t) => /read|list|search|get/i.test(t.name));
  if (!probeTool) {
    // 工具列表**无凭据就拿到了**，而没有可用作探针的工具 ⇒ 关于凭据一无所知。
    // 这里不能记 key-required：那会把「没验」当成「验过要凭据」。
    out.detail = `tools/list ${tools.length}，但没有识别出可用作探针的工具，无法判定`;
    return out;
  }
  const called = await call(
    "tools/call",
    { name: probeTool.name, arguments: {} },
    3,
  );
  const result = called.json?.result as
    | { content?: Array<{ text?: string }>; isError?: boolean }
    | undefined;
  if (result?.isError) {
    const text = (result.content ?? []).map((c) => c.text ?? "").join(" ");
    out.level = "key-required";
    out.detail = `无凭据调用被拒：${text.replace(/\s+/g, " ").slice(0, 120)}`;
    return out;
  }
  const gotData =
    Array.isArray(result?.content) &&
    (result?.content ?? []).some((c) => (c.text ?? "").length > 0);
  if (gotData) {
    out.detail = `无凭据就能调到数据（${probeTool.name}）—— 这不是 key 型`;
    return out;
  }
  if (called.json?.error || demandsCredentials(called.status, called.text)) {
    const why = called.json?.error
      ? JSON.stringify(called.json.error)
      : called.text;
    out.level = "key-required";
    out.detail = `无凭据调用被拒：${why.replace(/\s+/g, " ").slice(0, 120)}`;
    return out;
  }
  out.detail = `无凭据调用既没数据也没报错，无法判定`;
  return out;
}
