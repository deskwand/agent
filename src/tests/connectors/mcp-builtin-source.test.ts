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
  return { loaded: { servers, errors: [] }, statusFor };
}

const CHROME: McpServerEntry = {
  name: "Chrome",
  config: { type: "stdio", command: "npx" },
  source: "test",
  scope: "global",
};

describe("BUILTIN_PRESETS", () => {
  it("has exactly 3 entries", () => {
    expect(BUILTIN_PRESETS).toHaveLength(3);
  });

  it("names are frozen — changing them breaks prompt cache", () => {
    const names = BUILTIN_PRESETS.map((p) => p.name).sort();
    expect(names).toEqual(["Chrome", "GUI_Operate", "Software_Development"]);
  });
});

describe("buildBuiltinEntries", () => {
  it("produces one entry per preset", () => {
    expect(buildBuiltinEntries(ctx([]))).toHaveLength(3);
  });

  it("every entry uses tab=capability and source=mcp-builtin", () => {
    for (const e of buildBuiltinEntries(ctx([]))) {
      expect(e.tab).toBe("capability");
      expect(e.source).toBe("mcp-builtin");
    }
  });

  it("a preset absent from mcp.json has empty instances", () => {
    const chrome = buildBuiltinEntries(ctx([])).find(
      (e) => e.key === "mcp:builtin:Chrome",
    )!;
    expect(chrome.instances).toEqual([]);
  });

  it("a present preset gets one instance with the adapter status", () => {
    const chrome = buildBuiltinEntries(
      ctx([CHROME], (n) => (n === "Chrome" ? { kind: "ready" } : undefined)),
    ).find((e) => e.key === "mcp:builtin:Chrome")!;
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
    ).find((e) => e.key === "mcp:builtin:Chrome")!;
    expect(chrome.instances[0].status).toEqual({ kind: "off" });
  });

  it("does not claim progress when present but the adapter has no state", () => {
    const chrome = buildBuiltinEntries(ctx([CHROME])).find(
      (e) => e.key === "mcp:builtin:Chrome",
    )!;
    expect(chrome.instances[0].status).toEqual({ kind: "idle" });
  });
});
