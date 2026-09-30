import { describe, expect, it } from "vitest";
import { loadDeskwandMcpConfig } from "../../main/mcp/mcp-client-extension";

describe("builtin mcp extension assembly", () => {
  it("forces exposure=direct on every projected server (trap 1a)", () => {
    const projected = loadDeskwandMcpConfig();
    for (const server of projected.servers) {
      expect(server.config.exposure).toBe("direct");
    }
  });

  it("disables autoEnableCodemode so codemode cannot be activated (trap 1b)", () => {
    expect(loadDeskwandMcpConfig().autoEnableCodemode).toBe(false);
  });

  it("sanitizes server names the same way the old client did", () => {
    for (const server of loadDeskwandMcpConfig().servers) {
      expect(server.name).not.toMatch(/[\s]/);
      expect(server.name).not.toContain("__");
    }
  });
});
