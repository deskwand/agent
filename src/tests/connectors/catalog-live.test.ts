/**
 * 目录条目的活体验证 —— `npm run verify:catalog`。
 *
 * 默认**整体跳过**：它会真发网络请求、还会在厂商侧登记 OAuth client（L2），
 * 放进 CI 就会让某家厂商抖动变成随机红。
 *
 * 但阶梯逻辑本身有单元测试（用假 fetch），那部分永远跑，且一次网络都不发。
 */
import { describe, expect, it, vi } from "vitest";
import { MCP_CATALOG } from "../../shared/mcp-catalog";
import {
  verifyEndpoint,
  verifyKeyEndpoint,
  verifyOpenEndpoint,
} from "./catalog-live";

const AS_METADATA = {
  issuer: "https://auth.example.com",
  authorization_endpoint: "https://auth.example.com/authorize",
  token_endpoint: "https://auth.example.com/token",
  registration_endpoint: "https://auth.example.com/register",
  // SDK 的 startAuthorization 会先读这两个字段：缺 response_types_supported 会抛，
  // 声明了 code_challenge_methods_supported 但不含 S256 也会抛。工具必须同样严格。
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
};

function fakeFetch(
  routes: Record<
    string,
    { status: number; body?: unknown; text?: string; location?: string }
  >,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const hit = Object.entries(routes).find(([prefix]) =>
      url.startsWith(prefix),
    );
    // 未覆盖的路径返回 404 —— 真实的发现流程就会走到这些分支
    // （例如带路径与不带路径的两种 well-known 写法）。
    if (!hit) return new Response("not found", { status: 404 });
    const [, res] = hit;
    return new Response(res.text ?? JSON.stringify(res.body ?? {}), {
      status: res.status,
      headers: {
        "content-type": "application/json",
        ...(res.location ? { location: res.location } : {}),
      },
    });
  }) as unknown as typeof fetch;
}

describe("verifyEndpoint（OAuth 分支）", () => {
  it("returns metadata level when there is no registration endpoint", async () => {
    const f = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        status: 200,
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        body: { ...AS_METADATA, registration_endpoint: undefined },
      },
    });
    const r = await verifyEndpoint("https://mcp.example.com/mcp", f);
    expect(r.level).toBe("metadata");
    expect(r.registration).toBe(false);
  });

  it("sends the resource metadata's scopes_supported to the registration endpoint", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const base = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        status: 200,
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["mcp:read", "mcp:write"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        body: AS_METADATA,
      },
      "https://auth.example.com/register": {
        status: 201,
        body: { client_id: "abc" },
      },
      "https://auth.example.com/authorize": {
        status: 200,
        text: "<html>login</html>",
      },
    });
    const capturing = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input).includes("/register") && init?.body) {
        seen.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      }
      return base(input as string, init);
    }) as unknown as typeof fetch;

    const r = await verifyEndpoint("https://mcp.example.com/mcp", capturing);
    expect(r.level).toBe("registered");
    expect(seen).toHaveLength(1);
    expect(seen[0].scope).toBe("mcp:read mcp:write");
  });

  it("omits scope when the resource metadata has none", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const base = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        status: 200,
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        body: AS_METADATA,
      },
      "https://auth.example.com/register": {
        status: 201,
        body: { client_id: "abc" },
      },
      "https://auth.example.com/authorize": {
        status: 200,
        text: "<html>login</html>",
      },
    });
    const capturing = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input).includes("/register") && init?.body) {
        seen.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      }
      return base(input as string, init);
    }) as unknown as typeof fetch;

    await verifyEndpoint("https://mcp.example.com/mcp", capturing);
    expect(seen).toHaveLength(1);
    expect("scope" in seen[0]).toBe(false);
  });

  it("reaches registered level when DCR works and the authorize URL is accepted", async () => {
    const f = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        status: 200,
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        body: AS_METADATA,
      },
      "https://auth.example.com/register": {
        status: 201,
        body: { client_id: "abc" },
      },
      "https://auth.example.com/authorize": {
        status: 200,
        text: "<html>login</html>",
      },
    });
    const r = await verifyEndpoint("https://mcp.example.com/mcp", f);
    expect(r.level).toBe("registered");
    expect(r.registration).toBe(true);
    expect(r.authUrlAccepted).toBe(true);
  });

  it("stops at metadata when the authorize URL is rejected with invalid_client", async () => {
    const f = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        status: 200,
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        body: AS_METADATA,
      },
      "https://auth.example.com/register": {
        status: 201,
        body: { client_id: "abc" },
      },
      "https://auth.example.com/authorize": {
        status: 400,
        text: '{"error":"invalid_client"}',
      },
    });
    const r = await verifyEndpoint("https://mcp.example.com/mcp", f);
    expect(r.level).toBe("metadata");
    expect(r.authUrlAccepted).toBe(false);
    expect(r.detail).toContain("invalid_client");
  });
});

describe("默认模式不联网", () => {
  it("never falls back to the global fetch", async () => {
    // 上面所有用例都传了假 fetch；这条盯的是「模块里有没有偷偷用全局 fetch」——
    // 一旦有人漏传，CI 就会真的发请求，而默认模式下它必须一次都不发。
    const spy = vi.spyOn(globalThis, "fetch");
    const f = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        status: 200,
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        body: AS_METADATA,
      },
      "https://auth.example.com/register": {
        status: 201,
        body: { client_id: "abc" },
      },
      "https://auth.example.com/authorize": {
        status: 200,
        text: "<html>login</html>",
      },
    });
    await verifyEndpoint("https://mcp.example.com/mcp", f);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("verifyOpenEndpoint（免认证分支）", () => {
  it("reaches registered when tools/list works and a read tool returns data", async () => {
    // 同一个假响应要同时喂饱两步：tools/list 读 result.tools，L3′ 读 result.content。
    const f = fakeFetch({
      "https://mcp.open.example.com/mcp": {
        status: 200,
        text:
          'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"read_structure"}],' +
          '"content":[{"type":"text","text":"Available pages: ..."}]}}\n\n',
      },
    });
    const r = await verifyOpenEndpoint("https://mcp.open.example.com/mcp", f);
    expect(r.level).toBe("registered");
  });

  it("stops at metadata when the endpoint needs credentials", async () => {
    const f = fakeFetch({
      "https://mcp.walled.example.com/mcp": {
        status: 401,
        text: "unauthorized",
      },
    });
    const r = await verifyOpenEndpoint("https://mcp.walled.example.com/mcp", f);
    expect(r.level).toBe("none");
  });
});

describe("verifyKeyEndpoint（key 型分支）", () => {
  it("reaches key-required when the tool call is rejected for missing credentials", async () => {
    const f = fakeFetch({
      "https://mcp.keyed.example.com/mcp": {
        status: 200,
        text:
          'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_web"}],' +
          '"content":[{"type":"text","text":"Authentication failed: invalid key"}],"isError":true}}\n\n',
      },
    });
    const r = await verifyKeyEndpoint("https://mcp.keyed.example.com/mcp", f);
    expect(r.level).toBe("key-required");
  });

  it("reaches key-required when initialize answers a business error", async () => {
    // 高德那类：HTTP 200，体里是 INVALID_USER_KEY 而不是 JSON-RPC
    const f = fakeFetch({
      "https://mcp.amap.example.com/mcp": {
        status: 200,
        text: '{"status":"0","info":"INVALID_USER_KEY"}',
      },
    });
    const r = await verifyKeyEndpoint("https://mcp.amap.example.com/mcp", f);
    expect(r.level).toBe("key-required");
  });

  it("does not call an open server key-based", async () => {
    // 无凭据就能调到数据 ⇒ 那是免认证，不是 key 型。否则会把「不需要凭据」
    // 错记成「要凭据」，用户会去控制台白建一个 key。
    const f = fakeFetch({
      "https://mcp.open.example.com/mcp": {
        status: 200,
        text:
          'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"read_docs"}],' +
          '"content":[{"type":"text","text":"real data"}]}}\n\n',
      },
    });
    const r = await verifyKeyEndpoint("https://mcp.open.example.com/mcp", f);
    expect(r.level).toBe("none");
  });
});

/** 按调用顺序回包。`fakeFetch` 按 URL 前缀匹配，分不清 initialize / tools/list /
 *  tools/call 这三次调用 —— 而这几个回归用例恰恰要看第几次调用回了什么。 */
function sequencedFetch(
  steps: Array<{ status: number; text: string }>,
): typeof fetch {
  let i = 0;
  return (async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return new Response(step.text, {
      status: step.status,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
}

// 注意：下面的帧写成 `data:{…}`（冒号后**没有**空格），与腾讯位置服务一致 ——
// 这正是曾经把能用的端点误判成「tools/list 没有返回工具」的那个形态。
const INIT_FRAME =
  'event:message\ndata:{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}\n\n';
const frame = (obj: unknown): string =>
  `event:message\ndata:${JSON.stringify(obj)}\n\n`;
const TOOLS_FRAME = (name: string): string =>
  frame({ jsonrpc: "2.0", id: 2, result: { tools: [{ name }] } });

const CATALOG_CANDIDATES = process.env.CATALOG_CANDIDATES;
const enabled = process.env.VERIFY_CATALOG === "1";

describe.skipIf(!enabled)("live verification", () => {
  it("verifies every catalog entry", async () => {
    const targets = CATALOG_CANDIDATES
      ? (await import("node:fs"))
          .readFileSync(CATALOG_CANDIDATES, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
      : MCP_CATALOG.map((e) => e.url);

    const report: string[] = [];
    for (const url of targets) {
      // 三条分支，按各自的授权形态取一个：
      //  免认证（L2′/L3′）→ OAuth（L1/L2/L3）→ key（端点可达 + 无凭据被拒）
      // OAuth 排在 key 前面：带 OAuth 元数据的端点该归 registered，
      // 不能因为它的 initialize 也要凭据就被算成 key 型。
      const open = await verifyOpenEndpoint(url, fetch);
      const r =
        open.level === "registered"
          ? open
          : await (async () => {
              const oauth = await verifyEndpoint(url, fetch);
              if (oauth.level === "registered") return oauth;
              const key = await verifyKeyEndpoint(url, fetch);
              return key.level === "key-required" ? key : oauth;
            })();
      report.push(`${r.level.padEnd(10)} ${url}  ${r.detail}`);
    }
    // 防呆：列表为空时下面的循环会**空转通过**，把「什么都没验」伪装成「全绿」。
    expect(targets.length).toBeGreaterThan(0);
    expect(report).toHaveLength(targets.length);
    // 这是**工具的输出**（`npm run verify:catalog` 的产物），不是遗留调试语句。
    // eslint-disable-next-line no-console
    console.log("\n" + report.join("\n") + "\n");
    for (const line of report) {
      expect(/^(registered|key-required)/.test(line), line).toBe(true);
    }
  }, 1_800_000);
});

describe("verifyKeyEndpoint：真跑一轮发现的四个误判（回归）", () => {
  it("does not promote a 500 with a JSON body to key-required", async () => {
    // 假阳性最危险：verified 是写进目录的结论，而 500 说明端点挂了，不是「要凭据」。
    const f = fakeFetch({
      "https://mcp.broken.example.com/mcp": {
        status: 500,
        text: '{"status":500,"info":"INTERNAL_ERROR"}',
      },
    });
    const r = await verifyKeyEndpoint("https://mcp.broken.example.com/mcp", f);
    expect(r.level).not.toBe("key-required");
  });

  it("parses SSE frames written as `data:{…}` without a space", async () => {
    // 腾讯位置服务就是这么发的（`data:{…}`，冒号后没有空格）。只认 `data: `
    // 会把一个能用的端点误判成「tools/list 没有返回工具」。
    const f = sequencedFetch([
      { status: 200, text: INIT_FRAME },
      { status: 200, text: TOOLS_FRAME("placeSearch") },
      {
        status: 200,
        text: frame({
          jsonrpc: "2.0",
          id: 3,
          result: {
            content: [{ type: "text", text: "Invalid Key" }],
            isError: true,
          },
        }),
      },
    ]);
    const r = await verifyKeyEndpoint("https://mcp.nospace.example.com/mcp", f);
    expect(r.level).toBe("key-required");
    expect(r.detail).toContain("Invalid Key");
  });

  it("reads a 4xx plain-text credential demand (Baidu Maps: `400 ak is required`)", async () => {
    const f = fakeFetch({
      "https://mcp.baidu.example.com/mcp": {
        status: 400,
        text: "ak is required",
      },
    });
    const r = await verifyKeyEndpoint("https://mcp.baidu.example.com/mcp", f);
    expect(r.level).toBe("key-required");
  });

  it("reads a 401 with a non-JSON-RPC body (Youdao: `{error:10002}`)", async () => {
    const f = fakeFetch({
      "https://mcp.youdao.example.com/mcp": {
        status: 401,
        text: '{"error":10002,"desc":"authentication failed"}',
      },
    });
    const r = await verifyKeyEndpoint("https://mcp.youdao.example.com/mcp", f);
    expect(r.level).toBe("key-required");
  });

  it("does not call a data-returning tool call key-based (isError is what matters)", async () => {
    // 反向：无凭据真调到数据 ⇒ 免认证，不是 key 型
    const f = sequencedFetch([
      { status: 200, text: INIT_FRAME },
      { status: 200, text: TOOLS_FRAME("search_docs") },
      {
        status: 200,
        text: frame({
          jsonrpc: "2.0",
          id: 3,
          result: { content: [{ type: "text", text: "real data" }] },
        }),
      },
    ]);
    const r = await verifyKeyEndpoint(
      "https://mcp.trulyopen.example.com/mcp",
      f,
    );
    expect(r.level).toBe("none");
  });
});

describe("verifyOpenEndpoint：isError 不算「调到数据」", () => {
  it("refuses to call an endpoint open when the probe tool reports isError", async () => {
    // 腾讯位置服务无 key 时：{"content":[{"text":"Invalid Key"}],"isError":true}。
    // 旧逻辑只看「content 有没有文本」，会把 key 型误判成免认证（假阳性）。
    const f = sequencedFetch([
      { status: 200, text: INIT_FRAME },
      { status: 200, text: TOOLS_FRAME("placeSearchNearby") },
      {
        status: 200,
        text: frame({
          jsonrpc: "2.0",
          id: 3,
          result: {
            content: [{ type: "text", text: "Invalid Key" }],
            isError: true,
          },
        }),
      },
    ]);
    const r = await verifyOpenEndpoint(
      "https://mcp.tencent.example.com/mcp",
      f,
    );
    expect(r.level).not.toBe("registered");
  });
});
