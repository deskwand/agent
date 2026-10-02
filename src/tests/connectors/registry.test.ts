import { describe, expect, it, vi } from "vitest";
import {
  buildRegistry,
  type RegistryDeps,
} from "../../main/connectors/registry";
import type { CatalogEntry } from "../../shared/mcp-catalog";
import type { ActionResult, ConnectorStatus } from "../../shared/connectors";
import type {
  McpServerConfig,
  McpServerEntry,
} from "@earendil-works/pi-coding-agent";

const NOTION: CatalogEntry = {
  key: "notion",
  nameKey: "n",
  descriptionKey: "nd",
  url: "https://mcp.notion.com/mcp",
};

function httpServer(name: string, url: string, enabled = true): McpServerEntry {
  return {
    name,
    config: { type: "http", url, enabled },
    source: "test",
    scope: "global",
  };
}

function deps(
  over: Partial<RegistryDeps> & { servers?: McpServerEntry[] } = {},
) {
  const added: Array<{ name: string; config: McpServerConfig }> = [];
  const removed: string[] = [];
  const enabledCalls: Array<{ name: string; enabled: boolean }> = [];
  const credentialCalls: string[] = [];
  const activated: string[] = [];
  const signInCalls: string[] = [];

  const base: RegistryDeps = {
    loadConfig: () => ({ servers: over.servers ?? [], errors: [] }),
    statusFor: () => undefined,
    catalog: [NOTION],
    addServer: async (name, config) => {
      added.push({ name, config });
      return { ok: true };
    },
    removeServer: async (name) => {
      removed.push(name);
      return { ok: true };
    },
    setServerEnabled: async (name, enabled) => {
      enabledCalls.push({ name, enabled });
      return { ok: true };
    },
    signIn: async (_url, _openUrl) => {
      signInCalls.push(_url);
      return { ok: true };
    },
    removeCredentials: async (url) => {
      credentialCalls.push(url);
      return true;
    },
    activateNow: (name) => {
      activated.push(name);
      return true;
    },
    builtinConfigFor: (name) =>
      name === "Chrome" ? { type: "stdio", command: "npx" } : undefined,
    isValidServerName: (name) => /^[A-Za-z0-9_-]+$/.test(name),
    cancelSignIn: over.cancelSignIn ?? (() => true),
    hasCredentials: () => false,
    ...over,
  };

  return {
    deps: base,
    added,
    removed,
    enabledCalls,
    credentialCalls,
    activated,
    signInCalls,
  };
}

describe("registry.list", () => {
  it("aggregates remote and builtin entries", () => {
    const { deps: d } = deps();
    const all = buildRegistry(d).list();
    const tabs = new Set(all.map((e) => e.tab));
    expect(tabs).toEqual(new Set(["connect", "capability"]));
  });

  it("includes all three builtin presets", () => {
    const { deps: d } = deps();
    const builtin = buildRegistry(d)
      .list()
      .filter((e) => e.source === "mcp-builtin");
    expect(builtin).toHaveLength(3);
  });

  it("reflects mcp.json contents as instances", () => {
    const { deps: d } = deps({ servers: [httpServer("notion", NOTION.url)] });
    const notion = buildRegistry(d)
      .list()
      .find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances).toHaveLength(1);
  });

  it("uses statusFor for the instance status", () => {
    const statusFor = (n: string): ConnectorStatus | undefined =>
      n === "notion" ? { kind: "ready" } : undefined;
    const { deps: d } = deps({
      servers: [httpServer("notion", NOTION.url)],
      statusFor,
    });
    const notion = buildRegistry(d)
      .list()
      .find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances[0].status).toEqual({ kind: "ready" });
  });
});

describe("registry.addCatalogServer", () => {
  it("writes the catalog url as an http server", async () => {
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(res.ok).toBe(true);
    expect(added).toEqual([
      {
        name: "notion",
        config: { type: "http", url: NOTION.url, exposure: "direct" },
      },
    ]);
  });

  it("activates the server immediately after writing", async () => {
    const { deps: d, activated } = deps();
    await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(activated).toEqual(["notion"]);
  });

  it("reports pendingActivation when there is no session to connect into", async () => {
    // 没有活跃会话时 activateNow 返回 false。不把这个如实报出去的话，
    // 界面毫无变化，用户会以为「点了没反应」。
    const { deps: d } = deps({ activateNow: () => false });
    const res = await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(res.ok).toBe(true);
    expect(res.pendingActivation).toBe(true);
  });

  it("does not set pendingActivation when the server did connect", async () => {
    const { deps: d } = deps();
    const res = await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(res.pendingActivation).toBeUndefined();
  });

  it("rejects an unknown catalog key", async () => {
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).addCatalogServer("nope", vi.fn());
    expect(res.ok).toBe(false);
    expect(added).toEqual([]);
  });

  it("does not activate when the write failed", async () => {
    const { deps: d, activated } = deps({
      addServer: async () => ({ ok: false, error: "disk full" }),
    });
    const res = await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(res.ok).toBe(false);
    expect(activated).toEqual([]);
  });
});

describe("registry.addCatalogServer starts the sign-in", () => {
  it("calls signIn for the catalog url so the browser actually opens", async () => {
    // 回归：startSignIn 是唯一会打开浏览器的入口。只写配置、不调 signIn 的话，
    // 点「连接」在界面上毫无反应 —— 浏览器永远不开。
    const { deps: d, signInCalls } = deps();
    const openUrl = vi.fn();
    const res = await buildRegistry(d).addCatalogServer("notion", openUrl);

    expect(res.ok).toBe(true);
    expect(signInCalls).toEqual([NOTION.url]);
  });

  it("still writes the config before signing in", async () => {
    const { deps: d, added } = deps();
    await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(added.map((a) => a.name)).toEqual(["notion"]);
  });

  it("does not activate when sign-in failed", async () => {
    const { deps: d, activated } = deps({
      signIn: async () => ({ ok: false, error: "cancelled" }),
    });
    const res = await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(res.ok).toBe(false);
    expect(activated).toEqual([]);
  });

  it("activates after a successful sign-in", async () => {
    const { deps: d, activated } = deps();
    await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(activated).toEqual(["notion"]);
  });

  it("reports pendingActivation when sign-in worked but there is no session", async () => {
    const { deps: d } = deps({ activateNow: () => false });
    const res = await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(res.ok).toBe(true);
    expect(res.pendingActivation).toBe(true);
  });
});

describe("registry.removeServer", () => {
  it("removes config and credentials for a remote server", async () => {
    const {
      deps: d,
      removed,
      credentialCalls,
    } = deps({
      servers: [httpServer("notion", NOTION.url)],
    });
    const res = await buildRegistry(d).removeServer("notion");
    expect(res.ok).toBe(true);
    expect(removed).toEqual(["notion"]);
    expect(credentialCalls).toEqual([NOTION.url]);
  });

  it("does not touch credentials for a stdio server", async () => {
    const stdio: McpServerEntry = {
      name: "Chrome",
      config: { type: "stdio", command: "npx" },
      source: "test",
      scope: "global",
    };
    const { deps: d, credentialCalls } = deps({ servers: [stdio] });
    await buildRegistry(d).removeServer("Chrome");
    expect(credentialCalls).toEqual([]);
  });

  it("still removes config when the server is unknown to mcp.json", async () => {
    const { deps: d, removed } = deps();
    await buildRegistry(d).removeServer("ghost");
    expect(removed).toEqual(["ghost"]);
  });
});

describe("registry.setEnabled", () => {
  it("delegates to the enabled setter when the server already exists", async () => {
    const stdio: McpServerEntry = {
      name: "Chrome",
      config: { type: "stdio", command: "npx" },
      source: "test",
      scope: "global",
    };
    const { deps: d, enabledCalls } = deps({ servers: [stdio] });
    await buildRegistry(d).setEnabled("Chrome", false);
    expect(enabledCalls).toEqual([{ name: "Chrome", enabled: false }]);
  });

  it("creates an un-added builtin capability when switched on", async () => {
    // 能力 tab 的开关必须能在「还没添加」时直接打开 —— 否则那个开关永远是灰的
    const { deps: d, added, activated } = deps();
    const res = await buildRegistry(d).setEnabled("Chrome", true);
    expect(res.ok).toBe(true);
    expect(added.map((a) => a.name)).toEqual(["Chrome"]);
    expect(activated).toEqual(["Chrome"]);
  });

  it("does not create anything when switching off a missing capability", async () => {
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).setEnabled("Chrome", false);
    expect(res.ok).toBe(true);
    expect(added).toEqual([]);
  });

  it("rejects a name that is neither present nor a known capability", async () => {
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).setEnabled("Nope", true);
    expect(res.ok).toBe(false);
    expect(added).toEqual([]);
  });

  it("activates an existing server when re-enabled", async () => {
    const stdio: McpServerEntry = {
      name: "Chrome",
      config: { type: "stdio", command: "npx", enabled: false },
      source: "test",
      scope: "global",
    };
    const { deps: d, activated } = deps({ servers: [stdio] });
    await buildRegistry(d).setEnabled("Chrome", true);
    expect(activated).toEqual(["Chrome"]);
  });
});

describe("registry.authorize", () => {
  it("signs in using the server's url and activates on success", async () => {
    const {
      deps: d,
      signInCalls,
      activated,
    } = deps({
      servers: [httpServer("notion", NOTION.url)],
    });
    const openUrl = vi.fn();
    const res = await buildRegistry(d).authorize("notion", openUrl);
    expect(res.ok).toBe(true);
    expect(signInCalls).toEqual([NOTION.url]);
    expect(activated).toEqual(["notion"]);
  });

  it("rejects a server that is not remote", async () => {
    const stdio: McpServerEntry = {
      name: "Chrome",
      config: { type: "stdio", command: "npx" },
      source: "test",
      scope: "global",
    };
    const { deps: d, signInCalls } = deps({ servers: [stdio] });
    const res = await buildRegistry(d).authorize("Chrome", vi.fn());
    expect(res.ok).toBe(false);
    expect(signInCalls).toEqual([]);
  });

  it("rejects an unknown server", async () => {
    const { deps: d } = deps();
    const res = await buildRegistry(d).authorize("ghost", vi.fn());
    expect(res.ok).toBe(false);
  });

  it("does not activate when sign-in failed", async () => {
    const { deps: d, activated } = deps({
      servers: [httpServer("notion", NOTION.url)],
      signIn: async () => ({ ok: false, error: "cancelled" }),
    });
    const res = await buildRegistry(d).authorize("notion", vi.fn());
    expect(res.ok).toBe(false);
    expect(activated).toEqual([]);
  });
});

describe("registry.addCustomServer", () => {
  it("adds an http server from a url input", async () => {
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).addCustomServer({
      kind: "url",
      name: "mine",
      url: "https://example.com/mcp",
    });
    expect(res.ok).toBe(true);
    expect(added[0].name).toBe("mine");
    expect(added[0].config).toMatchObject({
      type: "http",
      url: "https://example.com/mcp",
    });
  });

  it("forces exposure=direct on json-pasted servers", async () => {
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).addCustomServer({
      kind: "json",
      payload: JSON.stringify({
        mcpServers: {
          local: { command: "node", args: ["s.js"], type: "stdio" },
        },
      }),
    });
    expect(res.ok).toBe(true);
    expect(added[0].config).toMatchObject({ exposure: "direct" });
  });

  it("adds every server in a multi-server json payload", async () => {
    const { deps: d, added } = deps();
    await buildRegistry(d).addCustomServer({
      kind: "json",
      payload: JSON.stringify({
        mcpServers: {
          a: { type: "http", url: "https://a/mcp" },
          b: { type: "http", url: "https://b/mcp" },
        },
      }),
    });
    expect(added.map((x) => x.name).sort()).toEqual(["a", "b"]);
  });

  it("rejects a name the SDK would refuse, instead of writing a dead entry", async () => {
    // 名字不合规的条目会被 SDK 在 registerMcpServer 抛异常、在 loadConfig 丢弃，
    // 静默留下一个永远连不上的条目。
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).addCustomServer({
      kind: "json",
      payload: JSON.stringify({
        mcpServers: { "My Server": { type: "http", url: "https://x/mcp" } },
      }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid server name/);
    expect(added).toEqual([]);
  });

  it("rejects malformed json without adding anything", async () => {
    const { deps: d, added } = deps();
    const res = await buildRegistry(d).addCustomServer({
      kind: "json",
      payload: "{ not json",
    });
    expect(res.ok).toBe(false);
    expect(added).toEqual([]);
  });

  it("reports the first failure from a multi-server payload", async () => {
    const { deps: d } = deps({
      addServer: async (name) =>
        name === "b" ? { ok: false, error: "nope" } : { ok: true },
    });
    const res = await buildRegistry(d).addCustomServer({
      kind: "json",
      payload: JSON.stringify({
        mcpServers: {
          a: { type: "http", url: "https://a/mcp" },
          b: { type: "http", url: "https://b/mcp" },
        },
      }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("nope");
  });
});

describe("registry error propagation", () => {
  it("surfaces an error from the add module", async () => {
    const { deps: d } = deps({
      addServer: async (): Promise<ActionResult> => ({
        ok: false,
        error: "boom",
      }),
    });
    const res = await buildRegistry(d).addCatalogServer("notion", vi.fn());
    expect(res.error).toBe("boom");
  });
});

describe("registry.cancelSignIn", () => {
  it("cancels the sign-in for the named remote server", () => {
    const cancelled: string[] = [];
    const { deps: d } = deps({
      servers: [
        {
          name: "notion",
          config: { type: "http", url: NOTION.url },
          source: "t",
          scope: "global",
        },
      ],
      cancelSignIn: (url: string) => {
        cancelled.push(url);
        return true;
      },
    });
    const res = buildRegistry(d).cancelSignIn("notion");
    expect(res.ok).toBe(true);
    expect(cancelled).toEqual([NOTION.url]);
  });

  it("reports when nothing was in flight, without pretending it failed", () => {
    const { deps: d } = deps({
      servers: [
        {
          name: "notion",
          config: { type: "http", url: NOTION.url },
          source: "t",
          scope: "global",
        },
      ],
      cancelSignIn: () => false,
    });
    const res = buildRegistry(d).cancelSignIn("notion");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no sign-in in progress");
  });

  it("rejects a server that is not remote", () => {
    const { deps: d } = deps({
      servers: [
        {
          name: "Chrome",
          config: { type: "stdio", command: "npx" },
          source: "t",
          scope: "global",
        },
      ],
    });
    expect(buildRegistry(d).cancelSignIn("Chrome").ok).toBe(false);
  });
});

describe("disconnect during authorization", () => {
  it("cancels the sign-in before removing configuration and credentials", async () => {
    const order: string[] = [];
    const { deps: d } = deps({
      servers: [httpServer("notion", NOTION.url)],
      cancelSignIn: () => {
        order.push("cancel");
        return true;
      },
      removeServer: async () => {
        order.push("config");
        return { ok: true };
      },
      removeCredentials: async () => {
        order.push("credentials");
        return true;
      },
    });
    await buildRegistry(d).removeServer("notion");
    expect(order).toEqual(["cancel", "config", "credentials"]);
  });
});
