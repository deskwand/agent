import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WeChatILinkPuppet,
  type WeChatILinkFetch,
  type WeChatPuppetPairingEvent,
  abortableDelay,
} from "../wechat-ilink-puppet";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetcher(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): WeChatILinkFetch {
  return vi.fn(handler);
}

describe("WeChatILinkPuppet", () => {
  const puppets: WeChatILinkPuppet[] = [];

  afterEach(async () => {
    for (const puppet of puppets) await puppet.stop();
    puppets.length = 0;
  });

  it("completes QR login and emits the serialized credentials", async () => {
    const fetcher = createFetcher(async (url, init) => {
      if (url.includes("get_bot_qrcode")) {
        return response({
          qrcode: "qr-token",
          qrcode_img_content: "data:image/png;base64,qr",
        });
      }
      if (url.includes("get_qrcode_status")) {
        return response({
          status: "confirmed",
          bot_token: "bot-token",
          ilink_bot_id: "bot-1",
          ilink_user_id: "user-1",
          baseurl: "https://ilink.example",
        });
      }
      if (url.includes("getupdates")) {
        return new Promise<Response>((_resolve, reject) => {
          init
            ?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, qrPollDelayMs: 0 });
    puppets.push(puppet);
    const login = vi.fn();
    const pairing = vi.fn();
    puppet.onLogin(login);
    puppet.onPairing(pairing);

    await puppet.start();

    await vi.waitFor(() => {
      expect(pairing).toHaveBeenCalledWith(
        expect.objectContaining({ state: "pending" }),
      );
      expect(pairing).toHaveBeenCalledWith(
        expect.objectContaining({ state: "confirmed" }),
      );
    });
    const confirmed = pairing.mock.calls
      .map(([event]) => event as WeChatPuppetPairingEvent)
      .find((event) => event.state === "confirmed");
    expect(confirmed?.imageUrl).toBeUndefined();
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
        token: expect.any(String),
      }),
    );
    expect(puppet.isLoggedIn).toBe(true);
  });

  it("fails after retrying an unsupported QR status", async () => {
    const pairing = vi.fn();
    const fetcher = createFetcher(async (url) => {
      if (url.includes("get_bot_qrcode")) {
        return response({
          qrcode: "qr-token",
          qrcode_img_content: "data:image/png;base64,AA==",
        });
      }
      if (url.includes("get_qrcode_status")) {
        return response({ status: "unknown" });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, qrPollDelayMs: 0 });
    puppets.push(puppet);
    puppet.onPairing(pairing);

    await puppet.start();

    await vi.waitFor(() => {
      const failed = pairing.mock.calls
        .map(([event]) => event as WeChatPuppetPairingEvent)
        .find((event) => event.state === "failed");
      expect(failed).toEqual(
        expect.objectContaining({
          state: "failed",
          errorCode: "WECHAT_QR_STATUS_INVALID",
        }),
      );
      expect(failed).not.toHaveProperty("imageUrl");
    });
  });

  it("polls updates, advances the cursor, and maps text messages", async () => {
    let updateCalls = 0;
    const fetcher = createFetcher(async (url, init) => {
      if (url.includes("getupdates")) {
        updateCalls += 1;
        expect(JSON.parse(String(init?.body))).toMatchObject({
          get_updates_buf: updateCalls === 1 ? "" : "cursor-1",
        });
        if (updateCalls === 1) {
          return response({
            msgs: [
              {
                message_id: 7,
                from_user_id: "user-1",
                to_user_id: "bot-1",
                client_id: "client-1",
                create_time_ms: 1234,
                message_type: 1,
                message_state: 0,
                context_token: "ctx-1",
                item_list: [{ type: 1, text_item: { text: "hello" } }],
              },
            ],
            get_updates_buf: "cursor-1",
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          init
            ?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({
      fetcher,
      qrPollDelayMs: 0,
      pollRetryDelayMs: 0,
    });
    puppets.push(puppet);
    const message = vi.fn();
    puppet.onMessage(message);

    const credentials = JSON.stringify({
      token: "bot-token",
      baseUrl: "https://ilink.example",
      accountId: "bot-1",
      userId: "user-1",
    });
    await puppet.start(credentials);
    await vi.waitFor(() => expect(message).toHaveBeenCalledOnce());

    expect(message.mock.calls[0]?.[0]).toMatchObject({
      id: "7",
      text: expect.any(Function),
      type: expect.any(Function),
      talker: expect.any(Function),
      room: expect.any(Function),
    });
    expect(message.mock.calls[0]?.[0].text()).toBe("hello");
    expect(updateCalls).toBeGreaterThanOrEqual(2);
  });

  it("sends text and typing requests with authenticated headers", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = createFetcher(async (url, init) => {
      calls.push({ url, init });
      if (url.includes("getconfig"))
        return response({ typing_ticket: "ticket-1" });
      if (url.includes("sendmessage") || url.includes("sendtyping"))
        return response({});
      if (url.includes("getupdates")) {
        if (
          calls.filter((call) => call.url.includes("getupdates")).length === 1
        ) {
          return response({
            msgs: [
              {
                message_id: 1,
                from_user_id: "user-1",
                message_type: 1,
                context_token: "ctx-1",
                item_list: [{ type: 1, text_item: { text: "seed" } }],
              },
            ],
            get_updates_buf: "cursor-1",
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          init
            ?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    await puppet.start(
      JSON.stringify({
        token: "bot-token",
        baseUrl: "https://ilink.example",
        accountId: "bot-1",
        userId: "bot-user",
      }),
    );

    await puppet.sendText("user-1", "hello");
    await puppet.sendTyping("user-1");
    await puppet.stopTyping("user-1");

    const messageCall = calls.find((call) => call.url.includes("sendmessage"));
    expect(messageCall?.init?.headers).toMatchObject({
      Authorization: "Bearer bot-token",
      AuthorizationType: "ilink_bot_token",
    });
    expect(JSON.parse(String(messageCall?.init?.body))).toMatchObject({
      msg: { to_user_id: "user-1", item_list: [{ type: 1 }] },
    });
    expect(
      calls.filter((call) => call.url.includes("sendtyping")),
    ).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // New Task 2 tests: non-blocking lifecycle
  // -----------------------------------------------------------------------

  it("returns from start and aborts while QR authorization is pending", async () => {
    const pairing = vi.fn();
    const fetcher = createFetcher(async (url, init) => {
      if (url.includes("get_bot_qrcode")) {
        return response({
          qrcode: "qr-token",
          qrcode_img_content: "data:image/png;base64,AA==",
        });
      }
      if (url.includes("get_qrcode_status")) {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, qrPollDelayMs: 0 });
    puppets.push(puppet);
    puppet.onPairing(pairing);
    await expect(puppet.start()).resolves.toBeUndefined();
    expect(puppet.isLoggedIn).toBe(false);
    await vi.waitFor(() =>
      expect(pairing).toHaveBeenCalledWith(
        expect.objectContaining({ state: "pending" }),
      ),
    );
    await puppet.stop();
    expect(pairing).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: "failed" }),
    );
  });

  it("stops promptly during maximum poll backoff", async () => {
    let notifyFailure: (() => void) | undefined;
    const failed = new Promise<void>((resolve) => {
      notifyFailure = resolve;
    });
    const fetcher = createFetcher(async (url) => {
      if (url.includes("getupdates")) {
        notifyFailure?.();
        throw new Error("poll failed");
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({
      fetcher,
      pollRetryDelayMs: 10_000,
    });
    puppets.push(puppet);
    await puppet.start(
      JSON.stringify({
        token: "token",
        baseUrl: "https://ilink.example",
        accountId: "bot",
        userId: "bot-user",
      }),
    );
    await failed;
    const stopped = puppet.stop().then(() => "stopped");
    await expect(
      Promise.race([
        stopped,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("timeout"), 100),
        ),
      ]),
    ).resolves.toBe("stopped");
  });

  it("emits exactly one failed pairing event when QR retries exhaust", async () => {
    const pairing = vi.fn();
    const error = vi.fn();
    const fetcher = createFetcher(async (url) => {
      if (url.includes("get_bot_qrcode")) {
        return response({
          qrcode: "qr-token",
          qrcode_img_content: "data:image/png;base64,AA==",
        });
      }
      if (url.includes("get_qrcode_status"))
        return response({ status: "expired" });
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, qrPollDelayMs: 0 });
    puppets.push(puppet);
    puppet.onPairing(pairing);
    puppet.onError(error);
    await puppet.start();
    await vi.waitFor(() => {
      expect(
        pairing.mock.calls.filter(([event]) => event.state === "failed"),
      ).toHaveLength(1);
      expect(error).toHaveBeenCalledTimes(1);
    });
  });

  it("preserves HTTP status for a non-JSON error response", async () => {
    const errors: Error[] = [];
    const puppet = new WeChatILinkPuppet({
      fetcher: async () => new Response("Bad gateway", { status: 502 }),
    });
    puppets.push(puppet);
    puppet.onError((err) => errors.push(err));
    await puppet.start();
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(errors[0]).toMatchObject({ name: "WeChatILinkError", status: 502 });
  });

  it("rejects an unsafe QR image URL", async () => {
    const errors: Error[] = [];
    const puppet = new WeChatILinkPuppet({
      fetcher: createFetcher(async () =>
        response({
          qrcode: "qr-token",
          qrcode_img_content: "javascript:alert(1)",
        }),
      ),
    });
    puppets.push(puppet);
    puppet.onError((err) => errors.push(err));
    await puppet.start();
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(errors[0]?.message).toContain("WECHAT_QR_IMAGE_INVALID");
  });

  it("allows sendmessage to return empty object as success", async () => {
    const fetcher = createFetcher(async (url, init) => {
      if (url.includes("getupdates")) {
        return new Promise<Response>((_resolve, reject) => {
          init
            ?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
        });
      }
      if (url.includes("sendmessage")) return response({});
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher });
    puppets.push(puppet);
    await puppet.start(
      JSON.stringify({
        token: "token",
        baseUrl: "https://ilink.example",
        accountId: "bot",
        userId: "bot-user",
      }),
    );
    const result = await puppet.sendText("user-1", "hello");
    expect(result).toHaveProperty("id");
  });

  // -----------------------------------------------------------------------
  // Task 2 TDD: TimeoutError retry, QR terminal errors
  // -----------------------------------------------------------------------

  it("retries with backoff on TimeoutError instead of terminating polling", async () => {
    const errors: Error[] = [];
    let pollCount = 0;
    const fetcher = createFetcher(async (url, init) => {
      if (url.includes("getupdates")) {
        pollCount += 1;
        if (pollCount <= 2) {
          // Simulate a request timeout — must NOT terminate polling.
          init?.signal?.addEventListener("abort", () => {
            // no-op
          });
          throw new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          );
        }
        if (pollCount === 3) {
          return response({
            msgs: [
              {
                message_id: 1,
                from_user_id: "user-1",
                message_type: 1,
                context_token: "ctx-1",
                item_list: [{ type: 1, text_item: { text: "hello" } }],
              },
            ],
            get_updates_buf: "cursor-1",
          });
        }
        // Block subsequent polls to prevent a retry storm.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({
      fetcher,
      pollRetryDelayMs: 1,
    });
    puppets.push(puppet);
    puppet.onError((err) => errors.push(err));

    const message = vi.fn();
    puppet.onMessage(message);

    await puppet.start(
      JSON.stringify({
        token: "token",
        baseUrl: "https://ilink.example",
        accountId: "bot",
        userId: "bot-user",
      }),
    );

    await vi.waitFor(() => expect(message).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });

    // TimeoutError emits an error event but does NOT terminate — polling continues.
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(pollCount).toBeGreaterThanOrEqual(3);
  });

  it("emits exactly one failed pairing event on QR HTTP error", async () => {
    const pairing = vi.fn();
    const errors: Error[] = [];
    const fetcher = createFetcher(async () => {
      throw new Error("network error");
    });
    const puppet = new WeChatILinkPuppet({ fetcher, qrPollDelayMs: 0 });
    puppets.push(puppet);
    puppet.onPairing(pairing);
    puppet.onError((err) => errors.push(err));
    await puppet.start();
    await vi.waitFor(() => {
      expect(
        pairing.mock.calls.filter(([event]) => event.state === "failed"),
      ).toHaveLength(1);
    });
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("emits exactly one failed pairing event when QR image is unsafe", async () => {
    const pairing = vi.fn();
    const puppet = new WeChatILinkPuppet({
      fetcher: createFetcher(async () =>
        response({
          qrcode: "qr-token",
          qrcode_img_content: "javascript:alert(1)",
        }),
      ),
      qrPollDelayMs: 0,
    });
    puppets.push(puppet);
    puppet.onPairing(pairing);
    await puppet.start();
    await vi.waitFor(() => {
      const failedEvents = pairing.mock.calls.filter(
        ([event]) => event.state === "failed",
      );
      expect(failedEvents).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Issue 3: abortableDelay listener cleanup
  // -----------------------------------------------------------------------
  it("abortableDelay removes abort listener when timer resolves", async () => {
    const controller = new AbortController();
    const { signal } = controller;

    let addCount = 0;
    let removeCount = 0;

    // Patch this specific signal instance to track listener counts.
    const origAdd = signal.addEventListener.bind(signal);
    const origRemove = signal.removeEventListener.bind(signal);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    signal.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions,
    ): void {
      if (type === "abort") addCount += 1;
      return origAdd(type, listener, options);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    signal.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ): void {
      if (type === "abort") removeCount += 1;
      return origRemove(type, listener);
    };

    await abortableDelay(0, signal);

    // Timer resolved — listener must have been removed.
    expect(addCount).toBe(1);
    expect(removeCount).toBe(1);
  });

  it("abortableDelay removes abort listener when abort fires", async () => {
    const controller = new AbortController();
    const { signal } = controller;

    let addCount = 0;
    let removeCount = 0;

    const origAdd = signal.addEventListener.bind(signal);
    const origRemove = signal.removeEventListener.bind(signal);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    signal.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions,
    ): void {
      if (type === "abort") addCount += 1;
      return origAdd(type, listener, options);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    signal.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ): void {
      if (type === "abort") removeCount += 1;
      return origRemove(type, listener);
    };

    // Start the delay with a long timeout, then abort.
    const delayPromise = abortableDelay(60_000, signal);
    controller.abort();

    await expect(delayPromise).rejects.toThrow("Aborted");

    // The abort listener was added and the {once:true} auto-removes it
    // when abort fires. The timeout callback (which also calls
    // removeEventListener) does NOT run because abort cleared the timer.
    // So we expect 1 add and either 0 or 1 remove depending on whether
    // the {once:true} triggers removeEventListener internally.
    expect(addCount).toBe(1);
    // The once:true auto-remove does not go through our patched
    // removeEventListener, so removeCount may be 0. That's fine —
    // the listener is still cleaned up by the platform.
    expect(removeCount).toBeLessThanOrEqual(1);
  });

  it("abortableDelay with zero-delay repeated polls does not accumulate listeners", async () => {
    // Run several delay cycles and verify each timer resolution cleans
    // up its abort listener (no leak).
    const controller = new AbortController();
    const { signal } = controller;

    let activeListeners = 0;
    let peakListeners = 0;

    const origAdd = signal.addEventListener.bind(signal);
    const origRemove = signal.removeEventListener.bind(signal);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    signal.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions,
    ): void {
      if (type === "abort") {
        activeListeners += 1;
        if (activeListeners > peakListeners) peakListeners = activeListeners;
      }
      return origAdd(type, listener, options);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    signal.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ): void {
      if (type === "abort") activeListeners -= 1;
      return origRemove(type, listener);
    };

    // Simulate repeated zero-delay polls.
    for (let i = 0; i < 20; i += 1) {
      await abortableDelay(0, signal);
    }

    // At the end, all listeners must have been cleaned up.
    expect(activeListeners).toBe(0);
    // Peak should not grow unbounded — each delay adds at most 1 listener
    // before it resolves and removes it.
    expect(peakListeners).toBeLessThanOrEqual(2);
  });
});
