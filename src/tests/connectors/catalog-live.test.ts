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
import { verifyEndpoint, verifyOpenEndpoint } from "./catalog-live";

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
      // 先试免认证分支；没到 registered 再试 OAuth 分支。
      const open = await verifyOpenEndpoint(url, fetch);
      const r =
        open.level === "registered" ? open : await verifyEndpoint(url, fetch);
      report.push(`${r.level.padEnd(10)} ${url}  ${r.detail}`);
    }
    // 防呆：列表为空时下面的循环会**空转通过**，把「什么都没验」伪装成「全绿」。
    expect(targets.length).toBeGreaterThan(0);
    expect(report).toHaveLength(targets.length);
    // 这是**工具的输出**（`npm run verify:catalog` 的产物），不是遗留调试语句。
    // eslint-disable-next-line no-console
    console.log("\n" + report.join("\n") + "\n");
    for (const line of report) {
      expect(line.startsWith("registered"), line).toBe(true);
    }
  }, 1_800_000);
});
