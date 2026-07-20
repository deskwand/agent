import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenRouterPkceService,
  createPkcePair,
  exchangeOpenRouterCode,
  startOpenRouterCallbackServer,
} from "../../main/auth/openrouter-pkce-service";

async function httpGet(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on("end", resolve);
    });
    request.on("error", reject);
  });
}

describe("openrouter-pkce-service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a PKCE verifier and S256 challenge", () => {
    const { verifier, challenge } = createPkcePair(() => Buffer.alloc(32, 7));

    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toBe(challenge);
    expect(challenge).toHaveLength(43);
  });

  it("captures the auth code from the localhost callback", async () => {
    const callback = await startOpenRouterCallbackServer();

    await httpGet(`${callback.callbackUrl}?code=test-auth-code`);

    await expect(callback.waitForCode).resolves.toBe("test-auth-code");
    await callback.close();
  });

  it("exchanges an auth code for an OpenRouter API key", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ key: "sk-or-v1-test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const apiKey = await exchangeOpenRouterCode(
      {
        code: "auth-code",
        codeVerifier: "verifier",
      },
      fetchMock,
    );

    expect(apiKey).toBe("sk-or-v1-test");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/auth/keys",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("stores login state after exchanging the callback code", async () => {
    const saved = new Map<string, string>();
    const service = new OpenRouterPkceService({
      providerName: "OpenRouter",
      store: {
        getApiKey: async () => saved.get("apiKey"),
        setApiKey: async (apiKey) => {
          saved.set("apiKey", apiKey);
        },
        clear: async () => {
          saved.delete("apiKey");
        },
      },
      openExternal: vi.fn(async () => undefined),
      createCallbackServer: async () => ({
        callbackUrl: "http://127.0.0.1:4567/callback",
        waitForCode: Promise.resolve("returned-code"),
        close: async () => undefined,
      }),
      exchangeCode: vi.fn(async () => "sk-or-v1-saved"),
      createPkce: () => ({
        verifier: "pkce-verifier",
        challenge: "pkce-challenge",
      }),
    });

    const result = await service.login();

    expect(result).toEqual({
      apiKey: "sk-or-v1-saved",
      providerName: "OpenRouter",
    });
    await expect(service.status()).resolves.toEqual({
      loggedIn: true,
      providerName: "OpenRouter",
    });
  });

  it("clears login state on logout", async () => {
    const saved = new Map<string, string>([["apiKey", "sk-or-v1-existing"]]);
    const service = new OpenRouterPkceService({
      providerName: "OpenRouter",
      store: {
        getApiKey: async () => saved.get("apiKey"),
        setApiKey: async (apiKey) => {
          saved.set("apiKey", apiKey);
        },
        clear: async () => {
          saved.delete("apiKey");
        },
      },
    });

    await service.logout();

    await expect(service.status()).resolves.toEqual({
      loggedIn: false,
      providerName: "OpenRouter",
    });
  });
});
