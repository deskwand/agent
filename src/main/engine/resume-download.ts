/**
 * @module main/engine/resume-download
 *
 * 单文件**断点续传**下载：Range 续传 + 整文件 sha256 + 成功后原子改名。
 *
 * 为什么不用 `speech/installer.ts` 的 `downloadAndExtract`：那个的临时文件名按
 * 毫秒生成，中断即丢 —— 对 157MB 的模型可以接受，对 1.5GB 不行（用户拔一次
 * 网线就得从零重来）。这里固定 `.partial`，它本身就是续传的凭据。
 *
 * 服务端**忽略 Range** 时（返回 200）必须能从零覆盖写：不是所有 CDN 都支持
 * 断点，把 200 当成 206 会拼出一段"半新半旧"的坏文件 —— 而 sha256 会在最后
 * 发现它，代价是白下 1.5GB。所以这里看状态码，不看我们发了什么请求头。
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";

export async function downloadResumable(opts: {
  url: string;
  target: string;
  sha256: string;
  /** 期望字节数：用来算进度。缺省时进度按"已经下了多少"报，永远是 1。 */
  bytes?: number;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const partial = `${opts.target}.partial`;
  let from = 0;
  try {
    from = (await stat(partial)).size;
  } catch {
    from = 0; // 没有半成品，从零开始
  }
  // 半成品比目标还长（换过清单 / 上次写坏）：它只会让 Range 永远 416，删了重来
  if (opts.bytes !== undefined && from > opts.bytes) {
    await rm(partial, { force: true });
    from = 0;
  }

  const res = await fetch(opts.url, {
    headers: from > 0 ? { range: `bytes=${from}-` } : {},
    signal: opts.signal,
  });
  if (res.status === 416 && from > 0) {
    // 服务端说"你要的范围不存在" —— 半成品不可用，清掉重来一次（只重来一次，
    // 否则清单写错时会变成死循环）
    await rm(partial, { force: true });
    return downloadResumable({ ...opts, bytes: undefined });
  }
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }

  // 206 = 服务端认了 Range，可以接着写；200 = 它忽略了，从头覆盖写。
  const append = res.status === 206;
  if (!append) from = 0;

  const hash = createHash("sha256");
  // 用流而不是 readFile：续传时半成品可能已经是 600MB，整块读进主进程不值得
  if (from > 0) {
    for await (const chunk of createReadStream(partial)) hash.update(chunk);
  }

  const out = createWriteStream(partial, { flags: append ? "a" : "w" });
  let done = from;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      const buf = Buffer.from(chunk);
      // 等 write 回调：不等的话 1.5GB 会积在内存里
      await new Promise<void>((resolve, reject) => {
        out.write(buf, (error) => (error ? reject(error) : resolve()));
      });
      hash.update(buf);
      done += buf.length;
      if (opts.bytes) opts.onProgress(Math.min(1, done / opts.bytes));
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }

  const actual = hash.digest("hex");
  if (actual !== opts.sha256) {
    // 校验不过就删掉半成品：留着它下次会从"坏的位置"接着下
    await rm(partial, { force: true });
    throw new Error(`sha256 mismatch: expected ${opts.sha256}, got ${actual}`);
  }
  await rename(partial, opts.target);
}
