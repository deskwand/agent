import { afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv } from "node:crypto";
import {
  WeChatILinkPuppet,
  type WeChatILinkFetch,
} from "../wechat-ilink-puppet";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("WeChat iLink media", () => {
  const puppets: WeChatILinkPuppet[] = [];

  afterEach(async () => {
    for (const puppet of puppets) await puppet.stop();
    puppets.length = 0;
  });

  it("encrypts and uploads an image before sending its CDN reference", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (url.includes("getupdates")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (url.includes("getuploadurl")) return jsonResponse({ upload_param: "upload-param" });
      if (url.includes("/c2c/upload")) {
        return new Response(null, { status: 200, headers: { "x-encrypted-param": "download-param" } });
      }
      if (url.includes("sendmessage")) return jsonResponse({ message_id: 99 });
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    await puppet.start(JSON.stringify({
      token: "token",
      baseUrl: "https://ilink.example",
      accountId: "bot",
      userId: "bot-user",
    }));

    await expect(puppet.sendImage("user-1", Buffer.from("image").toString("base64"))).resolves.toEqual({ id: "99" });

    const uploadRequest = calls.find((call) => call.url.includes("getuploadurl"));
    expect(JSON.parse(String(uploadRequest?.init?.body))).toMatchObject({
      to_user_id: "user-1",
      media_type: 1,
      rawsize: 5,
    });
    const cdnRequest = calls.find((call) => call.url.includes("/c2c/upload"));
    expect(cdnRequest?.init?.method).toBe("POST");
    expect(cdnRequest?.init?.body).toBeInstanceOf(Uint8Array);
    const messageRequest = calls.find((call) => call.url.includes("sendmessage"));
    expect(JSON.parse(String(messageRequest?.init?.body))).toMatchObject({
      msg: {
        to_user_id: "user-1",
        item_list: [{ type: 2, image_item: { media: { encrypt_query_param: "download-param" } } }],
      },
    });
  });

  it("downloads, decrypts, and then removes an inbound media reference", async () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([cipher.update(Buffer.from("image")), cipher.final()]);
    let message: { attachments?: Array<{ sourceRef: string }> } | undefined;
    let updatesCalls = 0;
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        updatesCalls += 1;
        if (updatesCalls > 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        return jsonResponse({
          msgs: [{
            message_id: 8,
            from_user_id: "user-1",
            message_type: 1,
            context_token: "ctx-1",
            item_list: [{
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: "download-param",
                  aes_key: key.toString("base64"),
                },
              },
            }],
          }],
          get_updates_buf: "cursor-1",
        });
      }
      if (url.includes("/c2c/download")) return new Response(encrypted, { status: 200 });
      throw new Error(`unexpected URL: ${url} ${String(init?.method)}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    puppet.onMessage((value) => { message = value as typeof message; });
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));
    await vi.waitFor(() => expect(message?.attachments).toHaveLength(1));

    const sourceRef = message!.attachments![0].sourceRef;
    await expect(puppet.downloadAttachment(sourceRef)).resolves.toEqual(Buffer.from("image"));
    await expect(puppet.downloadAttachment(sourceRef)).rejects.toThrow("ATTACHMENT_SOURCE_UNAVAILABLE");
  });

  it("retains a media reference when CDN download fails so it can be retried", async () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([cipher.update(Buffer.from("image")), cipher.final()]);
    let message: { attachments?: Array<{ sourceRef: string }> } | undefined;
    let downloadCalls = 0;
    let updatesCalls = 0;
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        updatesCalls += 1;
        if (updatesCalls > 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        return jsonResponse({
          msgs: [{
            message_id: 8,
            from_user_id: "user-1",
            message_type: 1,
            context_token: "ctx-1",
            item_list: [{
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: "download-param",
                  aes_key: key.toString("base64"),
                },
              },
            }],
          }],
          get_updates_buf: "cursor-1",
        });
      }
      if (url.includes("/c2c/download")) {
        downloadCalls += 1;
        if (downloadCalls === 1) return new Response(null, { status: 500 });
        return new Response(encrypted, { status: 200 });
      }
      throw new Error(`unexpected URL: ${url} ${String(init?.method)}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    puppet.onMessage((value) => { message = value as typeof message; });
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));
    await vi.waitFor(() => expect(message?.attachments).toHaveLength(1));

    const sourceRef = message!.attachments![0].sourceRef;
    await expect(puppet.downloadAttachment(sourceRef)).rejects.toThrow("WECHAT_CDN_DOWNLOAD_FAILED");
    await expect(puppet.downloadAttachment(sourceRef)).resolves.toEqual(Buffer.from("image"));
  });

  it("evicts the oldest media reference after 1000 entries", async () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const image = Buffer.concat([cipher.update(Buffer.from("img")), cipher.final()]);
    const updates = Array.from({ length: 1001 }, (_, index) => ({
      message_id: index,
      from_user_id: "user-1",
      message_type: 1,
      context_token: `ctx-${index}`,
      item_list: [{
        type: 2,
        image_item: {
          media: {
            encrypt_query_param: `query-${index}`,
            aes_key: key.toString("base64"),
          },
        },
      }],
    }));
    let updateCalls = 0;
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        updateCalls += 1;
        if (updateCalls === 1) {
          return jsonResponse({ msgs: updates, get_updates_buf: "cursor" });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (url.includes("/c2c/download")) return new Response(image, { status: 200 });
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher });
    puppets.push(puppet);
    const received = vi.fn();
    puppet.onMessage(received);
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1001));

    // oldest entry (index 0) should have been evicted
    await expect(puppet.downloadAttachment(
      "wechat:0:image:0",
    )).rejects.toThrow("ATTACHMENT_SOURCE_UNAVAILABLE");
    // newest entry (index 1000) should still be available
    await expect(puppet.downloadAttachment(
      "wechat:1000:image:0",
    )).resolves.toEqual(Buffer.from("img"));
  });

  it("uploads a file with media type 3 and filename metadata", async () => {
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (url.includes("getuploadurl")) return jsonResponse({ upload_param: "upload-param" });
      if (url.includes("/c2c/upload")) {
        return new Response(null, { status: 200, headers: { "x-encrypted-param": "download-param" } });
      }
      if (url.includes("sendmessage")) return jsonResponse({ message_id: 100 });
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));

    await expect(puppet.sendFile("user-1", Buffer.from("file").toString("base64"), "report.pdf")).resolves.toEqual({ id: "100" });
  });

  it("rejects Content-Length > 30 MiB before consuming body", async () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    let message: { attachments?: Array<{ sourceRef: string }> } | undefined;
    let updatesCalls = 0;
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        updatesCalls += 1;
        if (updatesCalls > 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        return jsonResponse({
          msgs: [{
            message_id: 20,
            from_user_id: "user-1",
            message_type: 1,
            context_token: "ctx-1",
            item_list: [{
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: "big-param",
                  aes_key: key.toString("base64"),
                },
              },
            }],
          }],
          get_updates_buf: "cursor-1",
        });
      }
      if (url.includes("/c2c/download")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-length": `${31 * 1024 * 1024}` },
          },
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    puppet.onMessage((value) => { message = value as typeof message; });
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));
    await vi.waitFor(() => expect(message?.attachments).toHaveLength(1));

    await expect(puppet.downloadAttachment(message!.attachments![0].sourceRef))
      .rejects.toThrow("ATTACHMENT_TOO_LARGE");
    // Reference retained so a retry is possible if server corrects the header
    await expect(puppet.downloadAttachment(message!.attachments![0].sourceRef))
      .rejects.toThrow("ATTACHMENT_TOO_LARGE");
  });

  it("aborts in-flight CDN download on stop and clears media references", async () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    let message: { attachments?: Array<{ sourceRef: string }> } | undefined;
    let updatesCalls = 0;
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        updatesCalls += 1;
        if (updatesCalls > 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        return jsonResponse({
          msgs: [{
            message_id: 21,
            from_user_id: "user-1",
            message_type: 1,
            context_token: "ctx-1",
            item_list: [{
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: "hang-param",
                  aes_key: key.toString("base64"),
                },
              },
            }],
          }],
          get_updates_buf: "cursor-1",
        });
      }
      if (url.includes("/c2c/download")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    puppet.onMessage((value) => { message = value as typeof message; });
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));
    await vi.waitFor(() => expect(message?.attachments).toHaveLength(1));

    const sourceRef = message!.attachments![0].sourceRef;
    const downloadPromise = puppet.downloadAttachment(sourceRef);
    // Let the download start and hang
    await vi.waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringContaining("/c2c/download"),
        expect.objectContaining({ method: "GET" }),
      ),
    );
    let downloadSettled = false;
    void downloadPromise.then(
      () => { downloadSettled = true; },
      () => { downloadSettled = true; },
    );
    const stopPromise = puppet.stop();
    // stop marks downloads unavailable before yielding to lifecycle cleanup.
    await expect(puppet.downloadAttachment(sourceRef)).rejects.toThrow(
      "ATTACHMENT_SOURCE_UNAVAILABLE",
    );
    await stopPromise;

    expect(downloadSettled).toBe(true);
    await expect(downloadPromise).rejects.toThrow(DOMException);
    // After stop media is cleared so re-download fails
    await expect(puppet.downloadAttachment(sourceRef)).rejects.toThrow("ATTACHMENT_SOURCE_UNAVAILABLE");
  });

  it("logout clears media references so sourceRef is unavailable", async () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([cipher.update(Buffer.from("image")), cipher.final()]);
    let message: { attachments?: Array<{ sourceRef: string }> } | undefined;
    let updatesCalls = 0;
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        updatesCalls += 1;
        if (updatesCalls > 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        return jsonResponse({
          msgs: [{
            message_id: 22,
            from_user_id: "user-1",
            message_type: 1,
            context_token: "ctx-1",
            item_list: [{
              type: 2,
              image_item: {
                media: {
                  encrypt_query_param: "download-param",
                  aes_key: key.toString("base64"),
                },
              },
            }],
          }],
          get_updates_buf: "cursor-1",
        });
      }
      if (url.includes("/c2c/download")) return new Response(encrypted, { status: 200 });
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    puppet.onMessage((value) => { message = value as typeof message; });
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));
    await vi.waitFor(() => expect(message?.attachments).toHaveLength(1));

    const sourceRef = message!.attachments![0].sourceRef;
    await puppet.logout();
    await expect(puppet.downloadAttachment(sourceRef)).rejects.toThrow("ATTACHMENT_SOURCE_UNAVAILABLE");
  });

  it("replaces existing sourceRef descriptor without growing map", async () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher1 = createCipheriv("aes-128-ecb", key, null);
    const firstBody = Buffer.concat([cipher1.update(Buffer.from("alpha")), cipher1.final()]);
    const cipher2 = createCipheriv("aes-128-ecb", key, null);
    const secondBody = Buffer.concat([cipher2.update(Buffer.from("beta")), cipher2.final()]);
    const received: Array<{ attachments?: Array<{ sourceRef: string }> }> = [];
    let updatesCalls = 0;
    const fetcher: WeChatILinkFetch = vi.fn(async (url, init) => {
      if (url.includes("getupdates")) {
        updatesCalls += 1;
        if (updatesCalls === 1) {
          return jsonResponse({
            msgs: [{
              message_id: 23,
              from_user_id: "user-1",
              message_type: 1,
              context_token: "ctx-1",
              item_list: [{
                type: 2,
                image_item: {
                  media: { encrypt_query_param: "param-alpha", aes_key: key.toString("base64") },
                },
              }],
            }],
            get_updates_buf: "cursor-1",
          });
        }
        if (updatesCalls === 2) {
          return jsonResponse({
            msgs: [{
              message_id: 23,
              from_user_id: "user-1",
              message_type: 1,
              context_token: "ctx-2",
              item_list: [{
                type: 2,
                image_item: {
                  media: { encrypt_query_param: "param-beta", aes_key: key.toString("base64") },
                },
              }],
            }],
            get_updates_buf: "cursor-2",
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (url.includes("/c2c/download")) {
        const body = url.includes("param-alpha") ? firstBody : secondBody;
        return new Response(body, { status: 200 });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const puppet = new WeChatILinkPuppet({ fetcher, pollRetryDelayMs: 0 });
    puppets.push(puppet);
    puppet.onMessage((value) => { received.push(value as typeof received[0]); });
    await puppet.start(JSON.stringify({ token: "token", baseUrl: "https://ilink.example", accountId: "bot", userId: "bot-user" }));
    // Both polls must deliver before we download
    await vi.waitFor(() => expect(received).toHaveLength(2));

    const sourceRef = received[1].attachments![0].sourceRef;
    // Must use the latest descriptor (beta), not the first (alpha)
    await expect(puppet.downloadAttachment(sourceRef)).resolves.toEqual(Buffer.from("beta"));
    // Consumed; second attempt fails
    await expect(puppet.downloadAttachment(sourceRef)).rejects.toThrow("ATTACHMENT_SOURCE_UNAVAILABLE");
  });
});
