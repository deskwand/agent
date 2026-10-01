import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type McpOAuthProvider,
  OAuthCallbackServer,
  authorizeMcp,
} from "@earendil-works/pi-mcp/oauth";
import type * as OAuthModule from "@earendil-works/pi-mcp/oauth";
import {
  cancelSignIn,
  readCredentials,
  startSignIn,
} from "../../main/connectors/mcp-signin";

vi.mock("@earendil-works/pi-mcp/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof OAuthModule>();
  return { ...actual, authorizeMcp: vi.fn() };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const URL = "https://example.test/mcp";
let dir: string;
let callback: OAuthCallbackServer | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-signin-flow-"));
  callback = undefined;
  const listen = OAuthCallbackServer.listen.bind(OAuthCallbackServer);
  vi.spyOn(OAuthCallbackServer, "listen").mockImplementation(
    async (options) => {
      callback = await listen(options);
      return callback;
    },
  );
  vi.mocked(authorizeMcp).mockImplementation(async (provider) => {
    await provider.redirectToAuthorization(
      new globalThis.URL("https://example.test/authorize"),
    );
    return "REDIRECT";
  });
});

afterEach(async () => {
  cancelSignIn(URL);
  await callback?.close().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
});

function begin(openAuthorizationUrl = vi.fn()) {
  return startSignIn({
    agentDir: dir,
    serverUrl: URL,
    openAuthorizationUrl,
    timeoutMs: 1000,
  });
}

describe("sign-in lifecycle", () => {
  it("reserves the URL before the callback listener has finished starting", async () => {
    const gate = deferred<void>();
    const original = OAuthCallbackServer.listen.bind(OAuthCallbackServer);
    vi.mocked(OAuthCallbackServer.listen).mockImplementationOnce(
      async (options) => {
        await gate.promise;
        return original(options);
      },
    );
    const first = begin();
    const second = await begin();
    gate.resolve();
    cancelSignIn(URL);
    await first;
    expect(second).toEqual({ ok: false, error: "sign-in already in progress" });
  });

  it("cancels before listen completes without opening the authorization page", async () => {
    const gate = deferred<void>();
    const listen = OAuthCallbackServer.listen.bind(OAuthCallbackServer);
    vi.mocked(OAuthCallbackServer.listen).mockImplementationOnce(
      async (options) => {
        await gate.promise;
        return listen(options);
      },
    );
    const open = vi.fn();
    const pending = begin(open);
    const cancelled = cancelSignIn(URL);
    gate.resolve();
    const result = await pending;
    expect(cancelled).toBe(true);
    expect(result).toEqual({ ok: false, cancelled: true });
    expect(open).not.toHaveBeenCalled();
  });

  it("returns an intentional cancellation instead of a callback error", async () => {
    const waiting = deferred<void>();
    const wait = OAuthCallbackServer.prototype.waitForCallback;
    vi.spyOn(
      OAuthCallbackServer.prototype,
      "waitForCallback",
    ).mockImplementation(function (this: OAuthCallbackServer, state) {
      const pending = wait.call(this, state);
      waiting.resolve();
      return pending;
    });
    const pending = begin();
    await waiting.promise;
    expect(cancelSignIn(URL)).toBe(true);
    expect(await pending).toEqual({ ok: false, cancelled: true });
    expect(cancelSignIn(URL)).toBe(false);
  });

  it("does not save late tokens or open a browser after cancellation during discovery", async () => {
    const entered = deferred<McpOAuthProvider>();
    const resume = deferred<void>();
    vi.mocked(authorizeMcp).mockImplementationOnce(async (provider) => {
      entered.resolve(provider as McpOAuthProvider);
      await resume.promise;
      await provider.saveTokens({
        access_token: "late-token",
        token_type: "Bearer",
      });
      await provider.redirectToAuthorization(
        new globalThis.URL("https://example.test/authorize"),
      );
      return "AUTHORIZED";
    });
    const open = vi.fn();
    const pending = begin(open);
    await entered.promise;
    const cancelled = cancelSignIn(URL);
    resume.resolve();
    const result = await pending;
    expect(cancelled).toBe(true);
    expect(result).toEqual({ ok: false, cancelled: true });
    expect(readCredentials(dir)[URL]?.tokens).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});
