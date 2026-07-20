import crypto from "node:crypto";
import http from "node:http";
import Store from "electron-store";
import { shell } from "electron";
import type {
  OpenRouterAuthStatusResult,
  OpenRouterLoginResult,
} from "../../shared/ipc-types";

type FetchLike = typeof fetch;
type RandomBytesLike = (size: number) => Buffer;

interface OpenRouterKeyExchangeResponse {
  key?: string;
  api_key?: string;
}

export interface OpenRouterCallbackServer {
  callbackUrl: string;
  waitForCode: Promise<string>;
  close(): Promise<void>;
}

export interface OpenRouterCredentialStore {
  getApiKey(): Promise<string | undefined>;
  setApiKey(apiKey: string): Promise<void>;
  clear(): Promise<void>;
}

interface OpenRouterPkceServiceDeps {
  providerName?: string;
  store?: OpenRouterCredentialStore;
  openExternal?: (url: string) => Promise<void>;
  createCallbackServer?: () => Promise<OpenRouterCallbackServer>;
  exchangeCode?: (input: {
    code: string;
    codeVerifier: string;
    callbackUrl?: string;
  }) => Promise<string>;
  createPkce?: () => { verifier: string; challenge: string };
}

interface OpenRouterStoreSchema {
  apiKey?: string;
}

class ElectronOpenRouterCredentialStore implements OpenRouterCredentialStore {
  private readonly store = new Store<OpenRouterStoreSchema>({
    name: "openrouter-auth",
    defaults: {},
  });

  async getApiKey(): Promise<string | undefined> {
    const value = this.store.get("apiKey");
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.store.set("apiKey", apiKey);
  }

  async clear(): Promise<void> {
    this.store.delete("apiKey");
  }
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkcePair(
  randomBytesImpl: RandomBytesLike = crypto.randomBytes,
): {
  verifier: string;
  challenge: string;
} {
  const verifier = toBase64Url(randomBytesImpl(32));
  const challenge = toBase64Url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

export async function startOpenRouterCallbackServer(): Promise<OpenRouterCallbackServer> {
  let server: http.Server | undefined;
  const waitForCode = new Promise<string>((resolve, reject) => {
    server = http.createServer((request, response) => {
      const requestUrl = request.url
        ? new URL(request.url, "http://127.0.0.1")
        : undefined;
      const code = requestUrl?.searchParams.get("code")?.trim();
      const error = requestUrl?.searchParams.get("error")?.trim();

      if (error) {
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(
          "OpenRouter authorization failed. You can close this tab.",
        );
        reject(new Error(error));
        return;
      }

      if (!code) {
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Missing authorization code. You can close this tab.");
        reject(new Error("Missing authorization code"));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("OpenRouter connected. You can close this tab.");
      resolve(code);
    });
    server.on("error", reject);
  });

  await new Promise<void>((resolve, reject) => {
    server?.listen(0, "127.0.0.1", () => resolve());
    server?.on("error", reject);
  });

  const address = server?.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    throw new Error("Failed to bind OpenRouter callback server");
  }

  return {
    callbackUrl: `http://127.0.0.1:${address.port}/callback`,
    waitForCode,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function exchangeOpenRouterCode(
  input: {
    code: string;
    codeVerifier: string;
    callbackUrl?: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: input.code,
      code_verifier: input.codeVerifier,
      code_challenge_method: "S256",
      callback_url: input.callbackUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter key exchange failed: ${response.status}`);
  }

  const payload = (await response.json()) as OpenRouterKeyExchangeResponse;
  const apiKey = payload.key || payload.api_key;
  if (!apiKey) {
    throw new Error("OpenRouter key exchange did not return an API key");
  }
  return apiKey;
}

export class OpenRouterPkceService {
  private readonly providerName: string;
  private readonly store: OpenRouterCredentialStore;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly createCallbackServer: () => Promise<OpenRouterCallbackServer>;
  private readonly exchangeCode: (input: {
    code: string;
    codeVerifier: string;
    callbackUrl?: string;
  }) => Promise<string>;
  private readonly createPkce: () => { verifier: string; challenge: string };

  constructor(deps: OpenRouterPkceServiceDeps = {}) {
    this.providerName = deps.providerName || "OpenRouter";
    this.store = deps.store || new ElectronOpenRouterCredentialStore();
    this.openExternal = deps.openExternal || shell.openExternal;
    this.createCallbackServer =
      deps.createCallbackServer || startOpenRouterCallbackServer;
    this.exchangeCode = deps.exchangeCode || exchangeOpenRouterCode;
    this.createPkce = deps.createPkce || createPkcePair;
  }

  async login(): Promise<OpenRouterLoginResult> {
    const callback = await this.createCallbackServer();
    const { verifier, challenge } = this.createPkce();
    const authUrl = new URL("https://openrouter.ai/auth");
    authUrl.searchParams.set("callback_url", callback.callbackUrl);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    try {
      await this.openExternal(authUrl.toString());
      const code = await callback.waitForCode;
      const apiKey = await this.exchangeCode({
        code,
        codeVerifier: verifier,
        callbackUrl: callback.callbackUrl,
      });
      await this.store.setApiKey(apiKey);
      return {
        apiKey,
        providerName: this.providerName,
      };
    } finally {
      await callback.close();
    }
  }

  async logout(): Promise<void> {
    await this.store.clear();
  }

  async status(): Promise<OpenRouterAuthStatusResult> {
    const apiKey = await this.store.getApiKey();
    return {
      loggedIn: Boolean(apiKey),
      providerName: this.providerName,
    };
  }
}

export const openRouterPkceService = new OpenRouterPkceService();
