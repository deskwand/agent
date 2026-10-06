import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadResumable } from "../../main/engine/resume-download";

const BODY = Buffer.alloc(4096, 7);
const SHA = createHash("sha256").update(BODY).digest("hex");

let server: Server | null = null;
const cleanup: string[] = [];

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  for (const dir of cleanup.splice(0))
    await rm(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-"));
  cleanup.push(dir);
  return dir;
}

/**
 * 第一次连接只发一半就断开（模拟拔网线），之后按 Range 续传。
 * `ignoreRange = true` 时永远返回 200 全量 —— CDN 的另一种行为。
 */
async function startServer(opts: {
  breakFirst: boolean;
  ignoreRange: boolean;
}) {
  const ranges: string[] = [];
  let calls = 0;
  server = createServer((req, res) => {
    calls += 1;
    const range = req.headers.range;
    if (typeof range === "string") ranges.push(range);
    const start =
      range && !opts.ignoreRange
        ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
        : 0;
    if (opts.breakFirst && calls === 1 && !opts.ignoreRange) {
      // 声明全长、只发一半：客户端看到的是**截断**（而不是一个完整的小文件）
      res.writeHead(206, { "content-length": String(BODY.length) });
      res.write(BODY.subarray(0, BODY.length / 2), () => res.destroy());
      return;
    }
    const slice = BODY.subarray(start);
    res.writeHead(start > 0 ? 206 : 200, {
      "content-length": String(slice.length),
    });
    res.end(slice);
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const { port } = server!.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/model.bin`, ranges };
}

describe("downloadResumable", () => {
  it("断开后重来：半成品留在 .partial，第二次带 range 续上，校验通过后改名", async () => {
    const dir = tempDir();
    const target = join(dir, "model.bin");
    const { url, ranges } = await startServer({
      breakFirst: true,
      ignoreRange: false,
    });

    await expect(
      downloadResumable({
        url,
        target,
        sha256: SHA,
        bytes: BODY.length,
        onProgress: () => {},
      }),
    ).rejects.toThrow();

    // 中断时：目标不存在，半成品在 .partial
    expect(() => statSync(target)).toThrow();
    expect(statSync(`${target}.partial`).size).toBe(BODY.length / 2);

    await downloadResumable({
      url,
      target,
      sha256: SHA,
      bytes: BODY.length,
      onProgress: () => {},
    });

    // 续传请求带了正确的 range，拼完与原文一致
    expect(ranges[0]).toBe(`bytes=${BODY.length / 2}-`);
    expect(readFileSync(target).equals(BODY)).toBe(true);
    expect(readdirSync(dir)).toEqual(["model.bin"]); // .partial 已经改名，不留残渣
  });

  it("服务端忽略 Range（200）时从零覆盖写，不拼出坏文件", async () => {
    const dir = tempDir();
    const target = join(dir, "model.bin");
    const { url } = await startServer({ breakFirst: false, ignoreRange: true });

    // 先摆一个"上次残留"的半成品，逼它走"有 .partial 但服务端不支持 Range"这条路
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${target}.partial`, Buffer.alloc(100, 1));

    await downloadResumable({ url, target, sha256: SHA, onProgress: () => {} });
    expect(readFileSync(target).equals(BODY)).toBe(true);
  });

  it("sha256 不符时删掉半成品并报错", async () => {
    const dir = tempDir();
    const target = join(dir, "model.bin");
    const { url } = await startServer({
      breakFirst: false,
      ignoreRange: false,
    });

    await expect(
      downloadResumable({ url, target, sha256: "00", onProgress: () => {} }),
    ).rejects.toThrow(/sha256 mismatch/);
    expect(readdirSync(dir)).toEqual([]);
  });
});
