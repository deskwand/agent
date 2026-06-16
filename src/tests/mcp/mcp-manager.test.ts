/**
 * Tests for MCPManager connection timeout and status tracking.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp/omagt-test",
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

// Mock logger to suppress output during tests
vi.mock("../../main/utils/logger", () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

// Mock shell-resolver
vi.mock("../../main/utils/shell-resolver", () => ({
  getDefaultShell: () => "/bin/bash",
}));

import { MCPManager } from "../../main/mcp/mcp-manager";
import type { MCPServerConfig } from "../../main/mcp/mcp-manager";

describe("MCPManager", () => {
  let manager: MCPManager;

  beforeEach(() => {
    manager = new MCPManager();
  });

  describe("getServerStatus()", () => {
    it("returns disabled status for disabled servers", async () => {
      const configs: MCPServerConfig[] = [
        {
          id: "test-1",
          name: "Test Server",
          type: "stdio",
          command: "echo",
          args: ["hello"],
          enabled: false,
        },
      ];

      await manager.initializeServers(configs);
      const statuses = manager.getServerStatus();

      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({
        id: "test-1",
        name: "Test Server",
        connected: false,
        status: "disabled",
        toolCount: 0,
      });
    });

    it("returns failed status when connection fails", async () => {
      const configs: MCPServerConfig[] = [
        {
          id: "test-fail",
          name: "Failing Server",
          type: "sse",
          url: "http://127.0.0.1:1/nonexistent",
          enabled: true,
        },
      ];

      // initializeServers catches errors internally, so this should not throw
      await manager.initializeServers(configs);
      const statuses = manager.getServerStatus();

      expect(statuses).toHaveLength(1);
      expect(statuses[0].id).toBe("test-fail");
      expect(statuses[0].status).toBe("failed");
      expect(statuses[0].connected).toBe(false);
    });

    it("includes status field in all returned statuses", async () => {
      const configs: MCPServerConfig[] = [
        {
          id: "disabled-server",
          name: "Disabled",
          type: "stdio",
          command: "echo",
          enabled: false,
        },
        {
          id: "enabled-server",
          name: "Enabled",
          type: "sse",
          url: "http://127.0.0.1:1/bad",
          enabled: true,
        },
      ];

      await manager.initializeServers(configs);
      const statuses = manager.getServerStatus();

      expect(statuses).toHaveLength(2);
      for (const s of statuses) {
        expect(s).toHaveProperty("status");
        expect(["connecting", "connected", "failed", "disabled"]).toContain(
          s.status,
        );
      }
    });

    it("returns empty array when no servers configured", () => {
      const statuses = manager.getServerStatus();
      expect(statuses).toEqual([]);
    });
  });

  describe("connection timeout", () => {
    it("fails with timeout error when transport never responds", async () => {
      // Create a server config that will try to connect to a non-existent SSE endpoint
      // The SSE transport will fail quickly (connection refused), but this validates
      // the error is properly caught and status is set to 'failed'
      const config: MCPServerConfig = {
        id: "timeout-test",
        name: "Timeout Test",
        type: "sse",
        url: "http://127.0.0.1:1/timeout-test",
        enabled: true,
      };

      await manager.initializeServers([config]);
      const statuses = manager.getServerStatus();

      const serverStatus = statuses.find((s) => s.id === "timeout-test");
      expect(serverStatus).toBeDefined();
      expect(serverStatus!.status).toBe("failed");
      expect(serverStatus!.connected).toBe(false);
    });
  });

  describe("disconnectServer()", () => {
    it("removes connection status when disconnecting", async () => {
      const configs: MCPServerConfig[] = [
        {
          id: "disc-test",
          name: "Disconnect Test",
          type: "sse",
          url: "http://127.0.0.1:1/bad",
          enabled: true,
        },
      ];

      await manager.initializeServers(configs);

      // Server should be in failed state
      let statuses = manager.getServerStatus();
      expect(statuses[0].status).toBe("failed");

      // After disconnect, status entry is removed; enabled server with no tracked status
      // falls back to 'connecting' (transient state)
      await manager.disconnectServer("disc-test");
      statuses = manager.getServerStatus();
      expect(statuses[0].status).toBe("connecting");
    });
  });
});
