import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IpcMain } from "electron";
import { mcpConfigPath } from "../../main/connectors/mcp-config-file";
import {
  cleanupRetiredPresets,
  RETIRED_PRESETS,
} from "../../main/connectors/retired-presets";
import { registerConnectorsIpc } from "../../main/connectors";
import type { ConnectorEntry } from "../../shared/connectors";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "retired-presets-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 下架时的字面定义，冻结在这里；实现里那份必须与它逐字一致。 */
const CHROME_ARGS = [
  "-y",
  "chrome-devtools-mcp@latest",
  "--browser-url",
  "http://localhost:9222",
];

function write(text: string): void {
  fs.writeFileSync(mcpConfigPath(dir), text);
}

function read(): string {
  return fs.readFileSync(mcpConfigPath(dir), "utf8");
}

function servers(): Record<string, unknown> {
  return JSON.parse(read()).mcpServers as Record<string, unknown>;
}

function chromeConfig(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type: "stdio", command: "npx", args: CHROME_ARGS, ...extra };
}

describe("RETIRED_PRESETS", () => {
  it("covers both presets retired together", () => {
    expect(RETIRED_PRESETS.map((p) => p.name).sort()).toEqual([
      "Chrome",
      "Software_Development",
    ]);
  });
});

describe("cleanupRetiredPresets", () => {
  it("removes the byte-for-byte Chrome leftover and keeps other servers", () => {
    write(
      JSON.stringify({
        mcpServers: {
          Chrome: chromeConfig(),
          notion: { type: "http", url: "https://mcp.notion.com/mcp" },
        },
      }),
    );

    expect(cleanupRetiredPresets(dir)).toEqual(["Chrome"]);
    expect(Object.keys(servers())).toEqual(["notion"]);
  });

  // 我们自己的版本写出的形状并不一致：10-01 那版 upsert 强制写 `exposure:"direct"`，
  // 开关还会补 `enabled`。拿整个条目对象比较会静默漏掉它们 —— 这条就是防那个。
  it.each([
    { label: "exposure", extra: { exposure: "direct" } },
    { label: "enabled", extra: { enabled: false } },
    { label: "both", extra: { exposure: "direct", enabled: true } },
  ])("removes the variant carrying $label", ({ extra }) => {
    write(JSON.stringify({ mcpServers: { Chrome: chromeConfig(extra) } }));

    expect(cleanupRetiredPresets(dir)).toEqual(["Chrome"]);
    expect(servers()).toEqual({});
  });

  it("keeps the entry when the user edited args", () => {
    const edited = {
      ...chromeConfig(),
      args: [...CHROME_ARGS.slice(0, 3), "http://localhost:9333"],
    };
    write(JSON.stringify({ mcpServers: { Chrome: edited } }));

    expect(cleanupRetiredPresets(dir)).toEqual([]);
    expect(servers().Chrome).toEqual(edited);
  });

  it("keeps a same-name server whose command the user wrote", () => {
    const own = {
      type: "stdio",
      command: "bunx",
      args: ["chrome-devtools-mcp@latest"],
    };
    write(JSON.stringify({ mcpServers: { Chrome: own } }));

    expect(cleanupRetiredPresets(dir)).toEqual([]);
    expect(servers().Chrome).toEqual(own);
  });

  it("removes the Software_Development leftover from any install path", () => {
    write(
      JSON.stringify({
        mcpServers: {
          Software_Development: {
            type: "stdio",
            command: "node",
            args: [
              "/Users/someone/else/Documents/DeskWand.app/Contents/Resources/mcp/software-dev-server-example.js",
            ],
            env: { WORKSPACE_DIR: "", TEST_ENV: "development" },
          },
        },
      }),
    );

    expect(cleanupRetiredPresets(dir)).toEqual(["Software_Development"]);
    expect(servers()).toEqual({});
  });

  it("leaves an unparseable file byte-identical", () => {
    write("{ not json");

    expect(cleanupRetiredPresets(dir)).toEqual([]);
    expect(read()).toBe("{ not json");
  });

  it("is idempotent and does not rewrite a clean file", () => {
    write(JSON.stringify({ mcpServers: { Chrome: chromeConfig() } }));
    expect(cleanupRetiredPresets(dir)).toEqual(["Chrome"]);
    const afterFirst = read();

    expect(cleanupRetiredPresets(dir)).toEqual([]);
    expect(read()).toBe(afterFirst);
  });

  it("returns [] when mcp.json does not exist", () => {
    expect(cleanupRetiredPresets(dir)).toEqual([]);
  });
});
describe("cleanupRetiredPresets — 误删与漏删的边界", () => {
  it("removes the Software_Development leftover resolved from source (.ts)", () => {
    write(
      JSON.stringify({
        mcpServers: {
          Software_Development: {
            type: "stdio",
            command: "node",
            args: [
              "/Users/me/src/agent/src/main/mcp/software-dev-server-example.ts",
            ],
          },
        },
      }),
    );

    expect(cleanupRetiredPresets(dir)).toEqual(["Software_Development"]);
  });

  it("removes the Software_Development leftover whose path never resolved", () => {
    write(
      JSON.stringify({
        mcpServers: {
          Software_Development: { type: "stdio", command: "node", args: [""] },
        },
      }),
    );

    expect(cleanupRetiredPresets(dir)).toEqual(["Software_Development"]);
  });

  it("keeps a node server the user pointed at their own script", () => {
    const own = {
      type: "stdio",
      command: "node",
      args: ["/Users/me/scripts/my-mcp-server.js"],
    };
    write(JSON.stringify({ mcpServers: { Software_Development: own } }));

    expect(cleanupRetiredPresets(dir)).toEqual([]);
    expect(servers().Software_Development).toEqual(own);
  });

  it("keeps a remote server that reuses a retired name", () => {
    const remote = { type: "http", url: "https://mcp.notion.com/mcp" };
    write(JSON.stringify({ mcpServers: { Chrome: remote } }));

    expect(cleanupRetiredPresets(dir)).toEqual([]);
    expect(servers().Chrome).toEqual(remote);
  });

  it("removes both leftovers from one file", () => {
    write(
      JSON.stringify({
        mcpServers: {
          Chrome: chromeConfig(),
          Software_Development: {
            type: "stdio",
            command: "node",
            args: [
              "/Applications/DeskWand.app/Contents/Resources/mcp/software-dev-server-example.js",
            ],
          },
          linear: { type: "http", url: "https://mcp.linear.app/mcp" },
        },
      }),
    );

    expect(cleanupRetiredPresets(dir).sort()).toEqual([
      "Chrome",
      "Software_Development",
    ]);
    expect(Object.keys(servers())).toEqual(["linear"]);
  });

  it("still cleans a valid leftover when another entry is malformed", () => {
    write(
      JSON.stringify({
        mcpServers: {
          Chrome: null,
          Software_Development: {
            type: "stdio",
            command: "node",
            args: [
              "/Applications/DeskWand.app/Contents/Resources/mcp/software-dev-server-example.js",
            ],
          },
        },
      }),
    );

    expect(cleanupRetiredPresets(dir)).toEqual(["Software_Development"]);
    expect(Object.keys(servers())).toEqual(["Chrome"]);
  });
});

describe("registerConnectorsIpc wiring", () => {
  /** 这套代码只用到 handle，其余成员不必伪造。 */
  function fakeIpcMain(): {
    ipcMain: IpcMain;
    handlers: Map<string, (...args: unknown[]) => unknown>;
  } {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      },
    } as unknown as IpcMain;
    return { ipcMain, handlers };
  }

  function register(ipcMain: IpcMain): void {
    registerConnectorsIpc({
      ipcMain,
      agentDir: dir,
      openUrl: () => {},
      sendToRenderer: () => {},
      activateMcpServer: () => false,
    });
  }

  it("drops the leftover before the page can list servers", async () => {
    write(
      JSON.stringify({
        mcpServers: { Chrome: chromeConfig({ enabled: false }) },
      }),
    );
    const { ipcMain, handlers } = fakeIpcMain();

    register(ipcMain);

    expect(servers()).toEqual({});
    const list = handlers.get("connectors.list") as (
      ...args: unknown[]
    ) => Promise<ConnectorEntry[]>;
    expect(list).toBeTypeOf("function");
    const entries = await list();
    expect(entries.some((e) => e.serverName === "Chrome")).toBe(false);
  });

  it("keeps a same-name server the user wrote themselves", async () => {
    write(
      JSON.stringify({
        mcpServers: {
          Chrome: {
            type: "stdio",
            command: "bunx",
            args: ["chrome-devtools-mcp@latest"],
          },
        },
      }),
    );
    const { ipcMain, handlers } = fakeIpcMain();

    register(ipcMain);

    const list = handlers.get("connectors.list") as (
      ...args: unknown[]
    ) => Promise<ConnectorEntry[]>;
    const entries = await list();
    expect(entries.some((e) => e.serverName === "Chrome")).toBe(true);
  });
});
