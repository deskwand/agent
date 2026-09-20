import type { AuthInteraction } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);
const ipcHandleMock = vi.hoisted(() => vi.fn());
const readStoredCredentialMock = vi.hoisted(() => vi.fn());
const modelRuntimeMock = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  removeRuntimeApiKey: vi.fn(),
}));
const clearQuotaCacheMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: { getLocale: vi.fn(() => "en") },
  BrowserWindow: vi.fn(),
  clipboard: { writeText: vi.fn() },
  ipcMain: { handle: ipcHandleMock },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  readStoredCredential: readStoredCredentialMock,
}));

vi.mock("../../main/agent/shared-model-runtime", () => ({
  getAuthPath: vi.fn(() => "/tmp/deskwand/auth.json"),
  getSharedModelRuntime: vi.fn(async () => modelRuntimeMock),
  invalidateSessionRuntimeApiKeys: vi.fn(),
}));

vi.mock("../../main/agent/subagent/provider-bridge", () => ({
  buildDeskWandProviderId: (profileKey: string) => `deskwand:${profileKey}`,
}));

vi.mock("../../main/quota", () => ({
  clearQuotaCache: clearQuotaCacheMock,
}));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: vi.fn(() => ({
      providers: { "oauth:openai-codex": {} },
    })),
  },
}));

vi.mock("../../main/utils/logger", () => ({ log: vi.fn() }));

import { initOAuthService } from "../../main/auth/oauth-service";
import {
  extractOAuthProviderId,
  isOAuthProfileKey,
  oauthProfileKey,
} from "../../shared/oauth-utils";

function handler(channel: string): (...args: unknown[]) => unknown {
  const found = handlers.get(channel);
  if (!found) throw new Error(`Missing IPC handler: ${channel}`);
  return found;
}

describe("oauth-service", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    ipcHandleMock.mockImplementation(
      (channel: string, callback: (...args: unknown[]) => unknown) => {
        handlers.set(channel, callback);
      },
    );
    readStoredCredentialMock.mockReturnValue(undefined);
    modelRuntimeMock.login.mockResolvedValue({ type: "oauth" });
    modelRuntimeMock.logout.mockResolvedValue(undefined);
    modelRuntimeMock.removeRuntimeApiKey.mockResolvedValue(undefined);
    initOAuthService();
  });

  it("skips non-forced login when a credential exists", async () => {
    readStoredCredentialMock.mockReturnValue({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 123,
    });

    await handler("auth.login")({}, "anthropic", false);

    expect(modelRuntimeMock.login).not.toHaveBeenCalled();
    // 这次什么都没改，不该清缓存（也钉住 clearQuotaCache 在 early return 之后）
    expect(clearQuotaCacheMock).not.toHaveBeenCalled();
  });

  it("forces OAuth login through ModelRuntime", async () => {
    readStoredCredentialMock.mockReturnValue({ type: "oauth" });

    await handler("auth.login")({}, "anthropic", true);

    // 换了账号（或新登录）后，旧账号的额度快照必须失效
    expect(clearQuotaCacheMock).toHaveBeenCalled();

    expect(modelRuntimeMock.login).toHaveBeenCalledWith(
      "anthropic",
      "oauth",
      expect.objectContaining({
        notify: expect.any(Function),
        prompt: expect.any(Function),
      }),
    );
    const interaction = modelRuntimeMock.login.mock
      .calls[0][2] as AuthInteraction;
    await expect(
      interaction.prompt({
        type: "select",
        message: "Choose",
        options: [],
      }),
    ).rejects.toThrow("Login cancelled");
  });

  it("propagates login persistence failure", async () => {
    modelRuntimeMock.login.mockRejectedValue(new Error("auth file locked"));

    await expect(handler("auth.login")({}, "anthropic", false)).rejects.toThrow(
      "auth file locked",
    );
  });

  it("returns stored OAuth expiry and provider name", async () => {
    readStoredCredentialMock.mockReturnValue({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 456,
    });

    const result = await handler("auth.status")({}, "anthropic");

    expect(result).toEqual({
      loggedIn: true,
      expiresAt: 456,
      providerName: "Anthropic",
    });
  });

  it("removes persistent and runtime auth on logout", async () => {
    const { invalidateSessionRuntimeApiKeys } =
      await import("../../main/agent/shared-model-runtime");
    await handler("auth.logout")({}, "openai-codex");

    expect(modelRuntimeMock.logout).toHaveBeenCalledWith("openai-codex");
    expect(modelRuntimeMock.removeRuntimeApiKey).toHaveBeenCalledWith(
      "openai-codex",
    );
    expect(modelRuntimeMock.removeRuntimeApiKey).toHaveBeenCalledWith(
      "deskwand:oauth:openai-codex",
    );
    expect(invalidateSessionRuntimeApiKeys).toHaveBeenCalledWith(
      "openai-codex",
    );
    expect(invalidateSessionRuntimeApiKeys).toHaveBeenCalledWith(
      "deskwand:oauth:openai-codex",
    );
    // 登出后旧账号的额度快照必须失效，否则 TTL 窗口内还会被读到
    expect(clearQuotaCacheMock).toHaveBeenCalled();
  });

  it("登出中途抛错时同样清空额度缓存（否则回落会把旧账号数字一直端出来）", async () => {
    modelRuntimeMock.removeRuntimeApiKey.mockRejectedValue(
      new Error("runtime key removal failed"),
    );

    await expect(handler("auth.logout")({}, "openai-codex")).rejects.toThrow();

    // clearQuotaCache 放在 finally：这一步失败时凭据可能已经没了，
    // 而失败回落会把还留在缓存里的旧快照当成有效数据一直返回。
    expect(clearQuotaCacheMock).toHaveBeenCalled();
  });
});

describe("oauth profile key helpers", () => {
  it("round-trips supported and future provider IDs", () => {
    const providerIds = [
      "openai-codex",
      "github-copilot",
      "anthropic",
      "xai",
      "qwen",
    ];

    for (const providerId of providerIds) {
      const profileKey = oauthProfileKey(providerId);
      expect(profileKey).toBe(`oauth:${providerId}`);
      expect(isOAuthProfileKey(profileKey)).toBe(true);
      expect(extractOAuthProviderId(profileKey)).toBe(providerId);
    }
  });

  it("rejects non-OAuth profile keys", () => {
    for (const profileKey of [
      "openai",
      "custom:abc",
      "anthropic",
      "deepseek",
      "",
    ]) {
      expect(isOAuthProfileKey(profileKey)).toBe(false);
      expect(extractOAuthProviderId(profileKey)).toBeUndefined();
    }
  });

  it("preserves an empty provider ID after the OAuth prefix", () => {
    expect(isOAuthProfileKey("oauth:")).toBe(true);
    expect(extractOAuthProviderId("oauth:")).toBe("");
  });
});
