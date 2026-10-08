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

  it("forwards the authorization response's iss to the code exchange (RFC 9207)", async () => {
    // 上游 1.1.0 起强制校验 iss：metadata 广告了
    // authorization_response_iss_parameter_supported 时，iss 为 undefined 会直接抛
    // OAuthIssuerMismatchError。这里断言我们把回调里的 iss 原样转发过去。
    vi.spyOn(
      OAuthCallbackServer.prototype,
      "waitForCallback",
    ).mockImplementationOnce(async (state) => ({
      code: "auth-code-from-as",
      state,
      iss: "https://as.example.test",
    }));

    const result = await begin();

    expect(result).toEqual({ ok: true });
    expect(vi.mocked(authorizeMcp).mock.calls[1]?.[1]).toMatchObject({
      authorizationCode: "auth-code-from-as",
      iss: "https://as.example.test",
    });
  });

  it("passes iss through as undefined when the authorization response has none", async () => {
    // 没发 iss 的服务器：我们传 undefined，上游在自己的 metadata 不支持 RFC 9207 时放行。
    vi.spyOn(
      OAuthCallbackServer.prototype,
      "waitForCallback",
    ).mockImplementationOnce(async (state) => ({
      code: "auth-code-from-as",
      state,
    }));

    const result = await begin();

    expect(result).toEqual({ ok: true });
    // 断言「确实发生了第二段调用」且 key 存在值为 undefined —— 只看
    // `calls[1]?.[1]?.iss` 会在第二段没发生时也通过（可选链吞掉）。
    const calls = vi.mocked(authorizeMcp).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]).toHaveProperty("iss", undefined);
  });
});
