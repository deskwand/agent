#!/usr/bin/env node
/**
 * 端点实测探针：给「来源=云端」挑预设用的四条判据（设计 §4.2）。
 *
 *   1. 首块 PCM ≤ 1.5s   2. abort 后 ≤ 300ms 停止出音
 *   3. response_format: pcm 生效（拿到的不是 mp3/wav/html）
 *   4. 位深 / 声道可由字节数 ÷ 时长推断
 *
 * 用法：
 *   node scripts/probe-tts-endpoints.mjs --self-test
 *   node scripts/probe-tts-endpoints.mjs --base-url https://api.example.com/v1 --key sk-... --model tts-1 --voice alloy
 *
 * 不满足 1–2 的端点：预设标 `streaming: false`（UI 出警示）。
 * 不满足 3 的端点：**不要进预设表** —— 拿不到 PCM 就不是本版能接的端点。
 */
import { createServer } from "node:http";

/** content-type → 我们能不能当 s16le PCM 收（与 providers/openai-compatible 同一套白名单）。 */
export function classify(contentType) {
  const ct = String(contentType ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (ct === "" || ct === "application/octet-stream") return "pcm";
  if (ct === "audio/pcm" || ct === "audio/l16") return "pcm";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("wav")) return "wav";
  return "other";
}

export async function measure({ url, headers, body, abortAfterMs = 4000 }) {
  const started = Date.now();
  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), abortAfterMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (error) {
    clearTimeout(killer);
    return { ok: false, error: ac.signal.aborted ? "timeout" : String(error) };
  }
  if (!res.ok || !res.body) {
    clearTimeout(killer);
    return {
      ok: false,
      status: res.status,
      detail: (await res.text().catch(() => "")).slice(0, 300),
    };
  }
  const kind = classify(res.headers.get("content-type"));
  let firstChunkMs = null;
  let chunks = 0;
  let bytes = 0;
  try {
    for await (const chunk of res.body) {
      if (firstChunkMs === null) firstChunkMs = Date.now() - started;
      chunks += 1;
      bytes += chunk.length;
    }
  } catch {
    /* abort 或断流都走这里 */
  }
  clearTimeout(killer);
  const endedAt = Date.now() - started;
  return {
    ok: true,
    status: res.status,
    kind,
    firstChunkMs,
    chunks,
    bytes,
    aborted: ac.signal.aborted,
    stopMs: ac.signal.aborted ? endedAt - abortAfterMs : null,
  };
}

async function selfTest() {
  const pcm = Buffer.alloc(3200); // 1600 个 s16le 样本
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "audio/pcm" });
    let n = 0;
    const tick = setInterval(() => {
      if (n++ >= 40) return (clearInterval(tick), res.end());
      res.write(pcm);
    }, 50);
    res.on("close", () => clearInterval(tick));
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const url = `http://127.0.0.1:${server.address().port}/audio/speech`;
  const result = await measure({
    url,
    headers: {},
    body: {},
    abortAfterMs: 1000,
  });
  server.close();
  const checks = [
    ["kind=pcm", result.kind === "pcm"],
    [
      "首块 ≤ 400ms",
      result.firstChunkMs !== null && result.firstChunkMs <= 400,
    ],
    ["收到 ≥ 3 块", result.chunks >= 3],
    ["abort 后 ≤ 300ms 停", result.stopMs !== null && result.stopMs <= 300],
  ];
  for (const [name, pass] of checks) {
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(result)}`,
    );
  }
  process.exit(checks.every(([, pass]) => pass) ? 0 : 1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const base = (arg("--base-url") ?? "").replace(/\/+$/, "");
  const key = arg("--key");
  const model = arg("--model");
  if (!base || !key || !model) {
    console.error("需要 --base-url / --key / --model（或用 --self-test）");
    process.exit(2);
  }
  const result = await measure({
    url: `${base}/audio/speech`,
    headers: { authorization: `Bearer ${key}` },
    body: {
      model,
      input: "你好，这是一次探针测试，用来测量首包、分块与中断行为。",
      voice: arg("--voice") ?? "alloy",
      response_format: "pcm",
    },
  });
  console.log(JSON.stringify(result, null, 2));
  const pass =
    result.ok &&
    result.kind === "pcm" &&
    result.firstChunkMs <= 1500 &&
    result.stopMs !== null &&
    result.stopMs <= 300;
  console.log(
    pass
      ? "✅ 满足四条判据：可以进预设表（verified: true）"
      : "❌ 不满足：按设计 §4.2 处置（streaming:false 或删掉该预设）",
  );
}
