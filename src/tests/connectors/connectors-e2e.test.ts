import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildRegistry,
  type RegistryDeps,
} from "../../main/connectors/registry";
import {
  isValidServerName,
  readMcpConfig,
  removeServer,
  setServerEnabled,
  upsertServer,
} from "../../main/connectors/mcp-config-file";
import {
  readCredentials,
  removeCredentials,
} from "../../main/connectors/mcp-signin";
import {
  BUILTIN_PRESETS,
  findBuiltinPresetByName,
} from "../../main/connectors/builtin-presets";
import { BUILTIN_PRESETS as TAB_PRESETS } from "../../main/connectors/sources/mcp-builtin-source";
import { MCP_CATALOG } from "../../shared/mcp-catalog";

/**
 * 端到端：用真实的文件读写 + 真实的内置预设，只把「与 SDK 交互」的部分替换掉。
 *
 * 这组测试防的是评审发现的回归 —— 配置层换成 mcp.json 之后，能力 tab 的三个开关
 * 一度变成永远灰的（预设没有任何路径写进 mcp.json）。
 */
let agentDir: string;
let activated: string[];

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "connectors-e2e-"));
  activated = [];
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
});

function realRegistry() {
  const deps: RegistryDeps = {
    loadConfig: () => readMcpConfig(agentDir),
    statusFor: () => undefined,
    catalog: MCP_CATALOG,
    addServer: async (name, config) => {
      try {
        upsertServer(agentDir, name, config);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    removeServer: async (name) => {
      removeServer(agentDir, name);
      return { ok: true };
    },
    setServerEnabled: async (name, enabled) =>
      setServerEnabled(agentDir, name, enabled)
        ? { ok: true }
        : { ok: false, error: `unknown server: ${name}` },
    signIn: async () => ({ ok: true }),
    removeCredentials: (url) => removeCredentials(agentDir, url),
    activateNow: (name) => {
      activated.push(name);
      return true;
    },
    builtinConfigFor: (name) => findBuiltinPresetByName(name)?.config(),
    isValidServerName,
    cancelSignIn: () => false,
    hasCredentials: (url) => Boolean(readCredentials(agentDir)[url]?.tokens),
  };
  return buildRegistry(deps);
}

describe("builtin capability names stay in sync", () => {
  it("the two BUILTIN_PRESETS lists use identical names", () => {
    // 一处是配置定义（写 mcp.json），一处是 UI 条目（渲染卡片）。
    // 名字对不上时「开关能点但写不进去」，且两边都不会报错。
    const configNames = BUILTIN_PRESETS.map((p) => p.name).sort();
    const tabNames = TAB_PRESETS.map((p) => p.name).sort();
    expect(tabNames).toEqual(configNames);
  });

  it("every capability card carries the server name used for lookup", () => {
    const entries = realRegistry()
      .list()
      .filter((e) => e.source === "mcp-builtin");
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(findBuiltinPresetByName(entry.serverName)).toBeDefined();
    }
  });
});

describe("enabling a capability that was never added", () => {
  it("writes it into mcp.json without an exposure key", async () => {
    const reg = realRegistry();
    const res = await reg.setEnabled("Chrome", true);

    expect(res.ok).toBe(true);
    const written = readMcpConfig(agentDir).servers;
    expect(written.map((s) => s.name)).toEqual(["Chrome"]);
    // 不写该键 ⇒ 上游取默认 codemode（pi 的参考实现）
    expect(written[0].config).not.toHaveProperty("exposure");
    expect(written[0].config.type).toBe("stdio");
  });

  it("activates it so it connects without waiting for a new session", async () => {
    await realRegistry().setEnabled("Chrome", true);
    expect(activated).toEqual(["Chrome"]);
  });

  it("works for all three presets", async () => {
    const reg = realRegistry();
    for (const preset of BUILTIN_PRESETS) {
      expect((await reg.setEnabled(preset.name, true)).ok).toBe(true);
    }
    expect(
      readMcpConfig(agentDir)
        .servers.map((s) => s.name)
        .sort(),
    ).toEqual(["Chrome", "GUI_Operate", "Software_Development"]);
  });

  it("resolves the packaged script path for node-based presets", async () => {
    // software-development 与 gui-operate 用 node 跑打包脚本；
    // 路径没解析出来会让 server 起不来（且不报错）
    await realRegistry().setEnabled("Software_Development", true);
    const config = readMcpConfig(agentDir).servers[0].config;
    expect("args" in config && config.args?.[0]).toBeTruthy();
    expect("args" in config && config.args?.[0]).not.toContain("{");
  });

  it("then the card shows an instance instead of an empty one", async () => {
    const reg = realRegistry();
    await reg.setEnabled("Chrome", true);
    const chrome = reg.list().find((e) => e.key === "mcp:builtin:Chrome")!;
    expect(chrome.instances).toHaveLength(1);
  });
});

describe("toggling a capability off and on again", () => {
  it("disables without removing the entry", async () => {
    const reg = realRegistry();
    await reg.setEnabled("Chrome", true);
    await reg.setEnabled("Chrome", false);

    const written = readMcpConfig(agentDir).servers;
    expect(written).toHaveLength(1);
    expect(written[0].config.enabled).toBe(false);
  });

  it("re-enables the existing entry rather than duplicating it", async () => {
    const reg = realRegistry();
    await reg.setEnabled("Chrome", true);
    await reg.setEnabled("Chrome", false);
    await reg.setEnabled("Chrome", true);

    expect(readMcpConfig(agentDir).servers).toHaveLength(1);
    expect(readMcpConfig(agentDir).servers[0].config.enabled).toBe(true);
  });
});

describe("connecting a catalog service end to end", () => {
  it("writes the catalog url and activates it", async () => {
    const reg = realRegistry();
    const res = await reg.addCatalogServer("notion", vi.fn());

    expect(res.ok).toBe(true);
    const written = readMcpConfig(agentDir).servers;
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe("notion");
    expect(written[0].config).toMatchObject({
      type: "http",
      url: "https://mcp.notion.com/mcp",
    });
    expect(written[0].config).not.toHaveProperty("exposure");
    expect(activated).toEqual(["notion"]);
  });

  it("surfaces it as a connected-candidate card, not a custom one", async () => {
    const reg = realRegistry();
    await reg.addCatalogServer("notion", vi.fn());
    const entries = reg.list();
    const notion = entries.find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances).toHaveLength(1);
    // 不应同时冒出一个「自建的 notion」条目
    expect(entries.filter((e) => e.key === "mcp:server:notion")).toHaveLength(
      0,
    );
  });

  it("removes it by name and clears its entry", async () => {
    const reg = realRegistry();
    await reg.addCatalogServer("notion", vi.fn());
    await reg.removeServer("notion");
    expect(readMcpConfig(agentDir).servers).toEqual([]);
  });
});

describe("pasting a mcpServers fragment", () => {
  it("adds every server without forcing exposure on any", async () => {
    const reg = realRegistry();
    const res = await reg.addCustomServer({
      kind: "json",
      payload: JSON.stringify({
        mcpServers: {
          local: { type: "stdio", command: "node", args: ["s.js"] },
          remote: { type: "http", url: "https://x/mcp" },
        },
      }),
    });

    expect(res.ok).toBe(true);
    const written = readMcpConfig(agentDir).servers;
    expect(written.map((s) => s.name).sort()).toEqual(["local", "remote"]);
    for (const server of written) {
      expect(server.config).not.toHaveProperty("exposure");
    }
  });

  it("rejects a fragment whose entries are not objects", async () => {
    const reg = realRegistry();
    const res = await reg.addCustomServer({
      kind: "json",
      payload: JSON.stringify({ mcpServers: { bad: "nope" } }),
    });
    expect(res.ok).toBe(false);
    expect(readMcpConfig(agentDir).servers).toEqual([]);
  });
});

describe("the key the UI passes to addCatalogServer", () => {
  it("is the catalog key the registry looks up, not the card's unique key", async () => {
    // 回归：卡片把 entry.key（"mcp:catalog:notion"）当 key 传下来，
    // 而 registry 是按目录的 key（"notion"）查表的 —— 直接传 entry.key
    // 会让每一次点「连接」都返回 "unknown catalog key"。
    const reg = realRegistry();
    for (const entry of reg.list()) {
      // 卡片需要知道该把什么交给 addCatalogServer
      expect(entry.instances).toBeDefined();
    }

    const catalogEntry = reg
      .list()
      .find((e) => e.key === "mcp:catalog:notion")!;
    // 目录项必须能反查出 registry 认的 key
    expect(catalogEntry.serverName).toBe("notion");
    expect(
      (await reg.addCatalogServer(catalogEntry.serverName, vi.fn())).ok,
    ).toBe(true);
  });

  it("rejects the card's composite key, proving the two are not interchangeable", async () => {
    const res = await realRegistry().addCatalogServer(
      "mcp:catalog:notion",
      vi.fn(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown catalog key/);
  });
});

describe("the exact value the UI now sends", () => {
  it("connects when handed entry.serverName (the regression that broke the button)", async () => {
    const reg = realRegistry();
    const card = reg.list().find((e) => e.key === "mcp:catalog:notion")!;

    // 这就是 ConnectorCard 现在传的东西
    const res = await reg.addCatalogServer(card.serverName, vi.fn());

    expect(res.ok).toBe(true);
    expect(readMcpConfig(agentDir).servers.map((s) => s.name)).toEqual([
      "notion",
    ]);
  });

  it("connects every catalog card in the list", async () => {
    const reg = realRegistry();
    for (const card of reg.list().filter((e) => e.source === "mcp-remote")) {
      expect((await reg.addCatalogServer(card.serverName, vi.fn())).ok).toBe(
        true,
      );
    }
    expect(readMcpConfig(agentDir).servers).toHaveLength(MCP_CATALOG.length);
  });
});

describe("i18n keys the sources emit", () => {
  const zh = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "src/renderer/i18n/locales/zh.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const en = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "src/renderer/i18n/locales/en.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

  function lookup(dict: Record<string, unknown>, key: string): unknown {
    let cur: unknown = dict;
    for (const part of key.split(".")) {
      if (typeof cur !== "object" || cur === null) return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  it("every nameKey and descriptionKey resolves in both locales", () => {
    for (const src of [
      "src/shared/mcp-catalog.ts",
      "src/main/connectors/sources/mcp-builtin-source.ts",
    ]) {
      const text = fs.readFileSync(path.join(process.cwd(), src), "utf8");
      for (const m of text.matchAll(/"(connectors\.[A-Za-z.]+)"/g)) {
        const key = m[1];
        expect(lookup(zh, key), `zh missing ${key}`).toBeTypeOf("string");
        expect(lookup(en, key), `en missing ${key}`).toBeTypeOf("string");
      }
    }
  });

  it("the summary keys the sources emit resolve too", () => {
    for (const key of [
      "connectors.summary.remote",
      "connectors.summary.local",
    ]) {
      expect(lookup(zh, key), `zh missing ${key}`).toBeTypeOf("string");
      expect(lookup(en, key), `en missing ${key}`).toBeTypeOf("string");
    }
  });

  it("the card renders summary through t(), not as a raw key", () => {
    // 回归：summary 改成 i18n key 后忘了包 t()，界面上直接显示
    // "connectors.summary.remote"。用 source 断言守这一类「漏了 t()」。
    const card = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/renderer/components/connectors/ConnectorCard.tsx",
      ),
      "utf8",
    );
    expect(card).toContain("t(instance.summary)");
    expect(card).not.toContain("{instance.summary}");
  });
});
