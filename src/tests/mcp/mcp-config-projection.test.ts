import { describe, expect, it } from "vitest";
import {
  projectMcpServers,
  sanitizeMcpServerKey,
  type ProjectionContext,
} from "../../main/mcp/mcp-config-projection";
import type { MCPServerConfig } from "../../main/mcp/mcp-config-store";

const ctx: ProjectionContext = {
  resolveServerPath: (token: string) => `/resolved/${token}`,
  resolveBundledNode: () => "/bundled/node",
  resolveWindowsNpx: (command: string) => `${command}.cmd`,
};

const stdio = (over: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
  id: "gui-operate",
  name: "GUI_Operate",
  type: "stdio",
  command: "node",
  args: ["{GUI_OPERATE_SERVER_PATH}"],
  env: {},
  enabled: true,
  ...over,
});

describe("mcp config projection", () => {
  it("forces exposure=direct and disables autoEnableCodemode (trap 1)", () => {
    const out = projectMcpServers([stdio()], ctx);
    expect(out.autoEnableCodemode).toBe(false);
    expect(out.servers[0].config.exposure).toBe("direct");
  });

  it("sanitizes the server name exactly like the old client did (tool names must not change)", () => {
    expect(sanitizeMcpServerKey("Software Development")).toBe(
      "Software_Development",
    );
    expect(sanitizeMcpServerKey("a__b")).toBe("a_b");
    expect(sanitizeMcpServerKey("GUI_Operate")).toBe("GUI_Operate");
    const out = projectMcpServers(
      [stdio({ name: "Software Development" })],
      ctx,
    );
    expect(out.servers[0].name).toBe("Software_Development");
  });

  it("resolves the server path placeholder and the bundled node", () => {
    const config = projectMcpServers([stdio()], ctx).servers[0].config as {
      command: string;
      args: string[];
    };
    expect(config.command).toBe("/bundled/node");
    expect(config.args).toEqual(["/resolved/GUI_OPERATE_SERVER_PATH"]);
  });

  it("keeps store-only fields out of the projected config", () => {
    const config = projectMcpServers([stdio()], ctx).servers[0]
      .config as unknown as Record<string, unknown>;
    expect(config).not.toHaveProperty("id");
    expect(config).not.toHaveProperty("requiresEnv");
    expect(config).not.toHaveProperty("envDescription");
  });

  it("carries enabled through", () => {
    const out = projectMcpServers([stdio({ enabled: false })], ctx);
    expect(out.servers[0].config.enabled).toBe(false);
  });

  it("passes env through untouched (shell-env merging happens at spawn time)", () => {
    const out = projectMcpServers(
      [stdio({ env: { WORKSPACE_DIR: "/w" } })],
      ctx,
    );
    expect(
      (out.servers[0].config as { env?: Record<string, string> }).env,
    ).toEqual({ WORKSPACE_DIR: "/w" });
  });

  it("projects streamable-http with url and headers", () => {
    const out = projectMcpServers(
      [
        stdio({
          id: "remote",
          name: "Remote",
          type: "streamable-http",
          url: "https://e.com/mcp",
          headers: { Authorization: "Bearer x" },
          command: undefined,
          args: undefined,
        }),
      ],
      ctx,
    );
    expect(out.servers[0].config).toMatchObject({
      type: "http",
      url: "https://e.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("projects sse as http too (the adapter picks the transport by store type)", () => {
    const out = projectMcpServers(
      [
        stdio({
          id: "s",
          name: "S",
          type: "sse",
          url: "https://e.com/sse",
          command: undefined,
          args: undefined,
        }),
      ],
      ctx,
    );
    expect(out.servers[0].config).toMatchObject({
      type: "http",
      url: "https://e.com/sse",
    });
  });

  it("collects an error and skips a server whose placeholder cannot resolve", () => {
    const failing: ProjectionContext = {
      ...ctx,
      resolveServerPath: () => {
        throw new Error("missing GUI_OPERATE_SERVER_PATH");
      },
    };
    const out = projectMcpServers([stdio()], failing);
    expect(out.servers).toHaveLength(0);
    expect(out.errors.join(" ")).toContain("GUI_OPERATE_SERVER_PATH");
  });
});
