// 引擎的「能出声」自检：起 server → POST 一句 → 断言收到 ≥1 字节 PCM。
//
// 不进默认流水线（要下 896MB 模型），由 workflow_dispatch 的 smoke 开关触发。
// 它验的是 CI 里编出来的那份二进制**真的能合成**，而不只是 `--help` 能跑 ——
// 动态库齐全与推理能跑是两件事（Metal/Vulkan 后端要在运行时才初始化）。
import { spawn } from "node:child_process";

const bin = process.env.BIN;
const model = process.env.MODEL;
const codec = process.env.CODEC;
const port = Number(process.env.PORT ?? 18099);

if (!bin || !model || !codec) {
  throw new Error("BIN, MODEL and CODEC are required");
}

const child = spawn(
  bin,
  [
    "--model",
    model,
    "--codec",
    codec,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    // 与监督器（src/main/engine/engine-supervisor.ts）的 argv 保持一致：
    // 自检要验的就是生产那一组参数，少一个 "--lang" 就等于没验到它
    "--lang",
    "chinese",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
child.stdout.on("data", (b) => process.stdout.write(`[server] ${b}`));
child.stderr.on("data", (b) => process.stderr.write(`[server] ${b}`));

const deadline = Date.now() + 180_000; // 冷启动实测 19.8s，给足余量
for (;;) {
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    if (health.ok) break;
  } catch {
    // 还没起来
  }
  if (Date.now() > deadline) {
    child.kill();
    throw new Error("server not ready in 180s");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const res = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    input: "语音引擎自检。", // i18n-allow-cjk 自检用语，产物丢弃
    voice: "vivian",
    language: "chinese",
    response_format: "pcm",
  }),
});
if (!res.ok || !res.body) {
  child.kill();
  throw new Error(`speech request failed: HTTP ${res.status}`);
}

let bytes = 0;
for await (const chunk of res.body) {
  bytes += chunk.length;
  if (bytes > 0) break; // 第一块到了就够：证明它真的在合成
}
child.kill();
if (bytes === 0) throw new Error("no pcm received");
console.log(`OK: received ${bytes} bytes of PCM`);
