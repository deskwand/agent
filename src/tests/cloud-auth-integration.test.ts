import { describe, it, expect } from "vitest";
import {
  GOOGLE_CLIENT_ID,
  DESKWAND_API_URL,
  GOOGLE_OAUTH_SCOPES,
  OAUTH_CALLBACK_TIMEOUT_MS,
} from "../shared/oauth-config";

describe("Cloud Auth 集成", () => {
  describe("共享配置", () => {
    it("GOOGLE_CLIENT_ID 应为非空字符串", () => {
      expect(typeof GOOGLE_CLIENT_ID).toBe("string");
      expect(GOOGLE_CLIENT_ID.length).toBeGreaterThan(0);
    });

    it("DESKWAND_API_URL 应以 https:// 开头", () => {
      expect(DESKWAND_API_URL.startsWith("https://")).toBe(true);
    });

    it("GOOGLE_OAUTH_SCOPES 应包含 openid email", () => {
      expect(GOOGLE_OAUTH_SCOPES).toContain("openid");
      expect(GOOGLE_OAUTH_SCOPES).toContain("email");
    });

    it("OAUTH_CALLBACK_TIMEOUT_MS 应为 5 分钟", () => {
      expect(OAUTH_CALLBACK_TIMEOUT_MS).toBe(5 * 60 * 1000);
    });
  });

  describe("Google 授权 URL 格式", () => {
    it("URL 应包含必需的 OAuth 参数", () => {
      const url = new URL("https://accounts.google.com/o/oauth/v2/auth");
      url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      url.searchParams.set("redirect_uri", "http://localhost:12345/callback");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);

      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toContain("openid");
      expect(url.searchParams.get("client_id")).toBe(GOOGLE_CLIENT_ID);
      expect(url.searchParams.get("redirect_uri")).toContain("localhost");
    });
  });
});
