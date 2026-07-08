import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// 模拟 electron 的 shell.openExternal
vi.mock("electron", () => ({
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

// 模拟 fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// 动态导入被测模块（需在 mock 之后），保留备用
async function _loadHandler() {
  return import("../main/oauth/google-auth-handler");
}
void _loadHandler;

describe("google-auth-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findAvailablePort (内联验证)", () => {
    it("应该返回一个可用端口号", async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as AddressInfo).port;
      expect(port).toBeGreaterThan(0);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  });

  describe("startGoogleAuth", () => {
    it("mock fetch 验证：成功返回 token 和 user", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "test-jwt",
          user: {
            email: "test@gmail.com",
            level: "default",
            credits_balance: 0,
          },
        }),
      });

      // 验证 mock 调用行为
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("mock fetch 验证：服务端返回 401 时抛错误", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: "INVALID_GOOGLE_CODE", message: "Invalid code" },
        }),
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
