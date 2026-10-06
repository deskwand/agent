import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";

import {
  FEED_IMAGE_PROTOCOL_SCHEME,
  buildFeedImageUrl,
  installFeedImageProtocol,
  registerFeedImageProtocolScheme,
  resolveFeedImagePath,
} from "../../main/feed/feed-image-protocol";

const DIR = "/tmp/feed-images";
const VALID_NAME = `${"a".repeat(40)}.jpg`;

describe("resolveFeedImagePath", () => {
  it("正常文件名解析到目录内", () => {
    expect(resolveFeedImagePath(DIR, VALID_NAME)).toBe(join(DIR, VALID_NAME));
  });

  it("拒绝路径穿越与子目录", () => {
    expect(resolveFeedImagePath(DIR, "../../etc/passwd")).toBeNull();
    expect(resolveFeedImagePath(DIR, "sub/a.jpg")).toBeNull();
    expect(resolveFeedImagePath(DIR, "..")).toBeNull();
  });

  it("拒绝非白名单扩展名与非法文件名", () => {
    expect(resolveFeedImagePath(DIR, "a.svg")).toBeNull();
    expect(resolveFeedImagePath(DIR, "a.exe")).toBeNull();
    expect(resolveFeedImagePath(DIR, "")).toBeNull();
    expect(resolveFeedImagePath(DIR, "有中文.jpg")).toBeNull();
  });
});

describe("buildFeedImageUrl", () => {
  it("URL 里带文件名，scheme 正确", () => {
    const url = buildFeedImageUrl(`${"a".repeat(40)}.png`);
    expect(url.startsWith(`${FEED_IMAGE_PROTOCOL_SCHEME}://`)).toBe(true);
    expect(url).toContain(".png");
  });
});

describe("installFeedImageProtocol", () => {
  it("把 scheme 交给 protocol.handle", async () => {
    const { protocol } = await import("electron");
    const spy = vi.spyOn(protocol, "handle");
    await installFeedImageProtocol(DIR);
    expect(spy).toHaveBeenCalledWith(
      FEED_IMAGE_PROTOCOL_SCHEME,
      expect.any(Function),
    );
    spy.mockRestore();
  });

  it("registerFeedImageProtocolScheme 不抛（mock 下是 no-op）", () => {
    expect(() => registerFeedImageProtocolScheme()).not.toThrow();
  });
});
