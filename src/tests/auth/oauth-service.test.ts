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
  });

  it("forces OAuth login through ModelRuntime", async () => {
    readStoredCredentialMock.mockReturnValue({ type: "oauth" });

    await handler("auth.login")({}, "anthropic", true);

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
