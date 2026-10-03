import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  buildBuiltinEntries,
} from "../../main/connectors/sources/mcp-builtin-source";
import type { ConnectorStatus } from "../../shared/connectors";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

function ctx(
  servers: McpServerEntry[],
  statusFor: (n: string) => ConnectorStatus | undefined = () => undefined,
) {
  return {
    loaded: { servers, errors: [] },
    statusFor,
    hasCredentials: () => false,
  };
}

const CHROME: McpServerEntry = {
  name: "GUI_Operate",
  config: { type: "stdio", command: "npx" },
  source: "test",
  scope: "global",
};

describe("BUILTIN_PRESETS", () => {
  it("has exactly one entry", () => {
    expect(BUILTIN_PRESETS).toHaveLength(1);
  });

  it("names are frozen — changing them breaks prompt cache", () => {
    const names = BUILTIN_PRESETS.map((p) => p.name).sort();
    expect(names).toEqual(["GUI_Operate"]);
  });
});

describe("buildBuiltinEntries", () => {
  it("produces one entry for the single preset", () => {
    expect(buildBuiltinEntries(ctx([]))).toHaveLength(1);
  });

  it("every entry uses transport=stdio and source=mcp-builtin", () => {
    for (const e of buildBuiltinEntries(ctx([]))) {
      expect(e.transport).toBe("stdio");
      expect(e.source).toBe("mcp-builtin");
    }
  });

  it("a preset absent from mcp.json has empty instances", () => {
    const chrome = buildBuiltinEntries(ctx([])).find(
      (e) => e.key === "mcp:builtin:GUI_Operate",
    )!;
    expect(chrome.instances).toEqual([]);
  });

  it("a present preset gets one instance with the adapter status", () => {
    const chrome = buildBuiltinEntries(
      ctx([CHROME], (n) => (n === "GUI_Operate" ? { kind: "ready" } : undefined)),
    ).find((e) => e.key === "mcp:builtin:GUI_Operate")!;
    expect(chrome.instances).toHaveLength(1);
    expect(chrome.instances[0].status).toEqual({ kind: "ready" });
  });

  it("enabled:false wins over the adapter state (shows as off)", () => {
    const disabled: McpServerEntry = {
      ...CHROME,
      config: { ...CHROME.config, enabled: false },
    };
    const chrome = buildBuiltinEntries(
      ctx([disabled], () => ({ kind: "ready" })),
    ).find((e) => e.key === "mcp:builtin:GUI_Operate")!;
    expect(chrome.instances[0].status).toEqual({ kind: "off" });
  });

  it("does not claim progress when present but the adapter has no state", () => {
    const chrome = buildBuiltinEntries(ctx([CHROME])).find(
      (e) => e.key === "mcp:builtin:GUI_Operate",
    )!;
    expect(chrome.instances[0].status).toEqual({ kind: "idle" });
  });
});
