import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../..");
function read(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

/**
 * 三层是分开写的（main 注册 / preload 暴露 / 全局类型声明），
 * 任何一处写错名字都不会被类型检查抓到 —— 这份源码级契约测试就是那道网。
 */
const CHANNELS = [
  "feed.list",
  "feed.getBody",
  "feed.setEnabled",
  "feed.markRead",
  "feed.markAllRead",
  "feed.dismiss",
  "feed.clearAll",
  "feed.refreshNow",
  "feed.setBlockedTopics",
];

describe("feed IPC 契约", () => {
  it("主进程注册了全部 feed.* 处理器", () => {
    const source = read("src/main/index.ts");
    for (const channel of CHANNELS) {
      expect(source, channel).toContain(`"${channel}"`);
    }
  });

  it("preload 暴露 feed 命名空间且逐项对上", () => {
    const source = read("src/preload/index.ts");
    expect(source).toContain("feed: {");
    for (const channel of CHANNELS) {
      expect(source, channel).toContain(`invoke("${channel}"`);
    }
  });

  it("全局 Window 类型里有 feed", () => {
    const source = read("src/preload/index.ts");
    const globalBlock = source.slice(source.indexOf("declare global"));
    expect(globalBlock).toContain("feed: {");
  });

  it("事件联合类型里有 feed.updated", () => {
    expect(read("src/renderer/types/index.ts")).toContain('"feed.updated"');
  });

  it("主进程装配里装了协议、启动了调度器、调用了 recover", () => {
    const source = read("src/main/index.ts");
    expect(source).toContain("installFeedImageProtocol");
    expect(source).toContain("registerFeedImageProtocolScheme()");
    expect(source).toContain("feedScheduler");
    expect(source).toContain("feedService.recover()");
  });

  it("CSP 允许配图 scheme", () => {
    expect(read("index.html")).toContain("deskwand-feed-image:");
  });

  it("图像缓存目录只有一处定义，且协议与写入用的是同一个", () => {
    const source = read("src/main/index.ts");
    const occurrences = source.match(/join\(app\.getPath\("userData"\), "feed-images"\)/g);
    // 一处给协议、一处给 service；两处必须都是同一表达式，不能一处写死别处
    expect(occurrences?.length).toBe(2);
  });
});
