import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  getCloudProvider,
  runCloudStream,
  type CloudTtsProvider,
  type SpeechOut,
} from "../../main/tts/cloud";

function fakeEndpoint(mode: "pcm" | "mp3" | "html" | "short" | "401") {
  return createServer((_req, res) => {
    if (mode === "401") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }
    if (mode === "html") {
      // 200 但不是音频：白名单之外，必须拒绝
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>bad gateway</html>");
      return;
    }
    res.writeHead(200, {
      "content-type": mode === "mp3" ? "audio/mpeg" : "audio/pcm",
    });
    const pcm = Buffer.alloc(3200, 1);
    if (mode === "short") {
      res.write(pcm);
      setTimeout(() => res.destroy(), 30); // 中途断流
      return;
    }
    let n = 0;
    const tick = setInterval(() => {
      if (n++ >= 3) return (clearInterval(tick), res.end());
      res.write(pcm);
    }, 10);
    res.on("close", () => clearInterval(tick));
  });
}

function collector() {
  const events: string[] = [];
  const chunks: Float32Array[] = [];
  const out: SpeechOut = {
    chunk: (samples, sampleRate, seq) => {
      chunks.push(samples);
      events.push(`chunk:${seq}:${sampleRate}`);
    },
    done: () => events.push("done"),
    error: (code) => events.push(`error:${code}`),
  };
  return { out, events, chunks };
}

const baseReq = (baseUrl: string) => ({
  text: "你好",
  voiceId: "alloy",
  model: "tts-1",
  credentials: { apiKey: "sk-test" },
  baseUrl,
});

let server: ReturnType<typeof fakeEndpoint> | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

const listen = async () => {
  await new Promise<void>((resolve) =>
    server!.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server!.address() as { port: number };
  return `http://127.0.0.1:${port}/v1`;
};

/** 不联网的假 provider，用来测 runner 的编号 / 关闭语义 / 队列 / 切句。 */
function fakeProvider(over: Partial<CloudTtsProvider> = {}): CloudTtsProvider {
  return {
    id: "fake",
    labelKey: "fake",
    capabilities: {
      sampleRate: 24000,
      format: "pcm_s16le",
      instructions: false,
    },
    credentials: [],
    curatedVoices: [],
    tierModels: () => "m",
    async stream(_req, sink) {
      sink.chunk(new Float32Array([0.1]), 24000);
      sink.done();
    },
    ...over,
  };
}

describe("openai-compatible（经本地假端点）", () => {
  it("分块 PCM 原样下传，seq 从 0 递增，最后有 done", async () => {
    server = fakeEndpoint("pcm");
    const url = await listen();
    const { out, events, chunks } = collector();
    await runCloudStream(
      getCloudProvider("openai-compatible")!,
      baseReq(url),
      out,
      new AbortController().signal,
    );
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(events[0]).toBe("chunk:0:24000");
    expect(events.at(-1)).toBe("done");
  });

  it("端点回 mp3（忽略 response_format）→ 报错，不把字节当 PCM", async () => {
    server = fakeEndpoint("mp3");
    const url = await listen();
    const { out, events, chunks } = collector();
    await runCloudStream(
      getCloudProvider("openai-compatible")!,
      baseReq(url),
      out,
      new AbortController().signal,
    );
    expect(chunks).toHaveLength(0);
    expect(events.at(-1)).toBe("error:failed");
  });

  it("200 但不是音频（text/html）→ 报错（白名单之外一律不放行）", async () => {
    server = fakeEndpoint("html");
    const url = await listen();
    const { out, events, chunks } = collector();
    await runCloudStream(
      getCloudProvider("openai-compatible")!,
      baseReq(url),
      out,
      new AbortController().signal,
    );
    expect(chunks).toHaveLength(0);
    expect(events.at(-1)).toBe("error:failed");
  });

  it("401 → auth；短读 → failed（整次失败，不发 done）", async () => {
    for (const [mode, expected] of [
      ["401", "error:auth"],
      ["short", "error:failed"],
    ] as const) {
      server = fakeEndpoint(mode);
      const url = await listen();
      const { out, events } = collector();
      await runCloudStream(
        getCloudProvider("openai-compatible")!,
        baseReq(url),
        out,
        new AbortController().signal,
      );
      expect(events).toContain(expected);
      expect(events).not.toContain("done");
      server.close();
      server = null;
    }
  });

  it("缺 key / 缺 baseUrl → unconfigured，握手都不发", async () => {
    const { out, events } = collector();
    await runCloudStream(
      getCloudProvider("openai-compatible")!,
      { ...baseReq(""), credentials: {} },
      out,
      new AbortController().signal,
    );
    expect(events).toEqual(["error:unconfigured"]);
  });
});

describe("runner 的切句与串行队列", () => {
  it("超长文本按 maxCharsPerRequest 切段发出，内容不丢", async () => {
    const received: string[] = [];
    const provider = fakeProvider({
      capabilities: {
        sampleRate: 24000,
        format: "pcm_s16le",
        instructions: false,
        maxCharsPerRequest: 10,
      },
      async stream(req, sink) {
        received.push(req.text);
        sink.chunk(new Float32Array([0]), 24000);
        sink.done();
      },
    });
    const text = "长".repeat(50);
    const { out } = collector();
    await runCloudStream(
      provider,
      { ...baseReq("x"), text },
      out,
      new AbortController().signal,
    );
    expect(received.length).toBe(5);
    expect(received.every((t) => t.length <= 10)).toBe(true);
    expect(received.join("")).toBe(text);
  });

  it("同一 provider 的两次调用串行执行（并发峰值为 1）", async () => {
    let inflight = 0;
    let peak = 0;
    const provider = fakeProvider({
      async stream(_req, sink) {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 10));
        sink.chunk(new Float32Array([0]), 24000);
        sink.done();
        inflight -= 1;
      },
    });
    const a = collector();
    const b = collector();
    await Promise.all([
      runCloudStream(
        provider,
        baseReq("x"),
        a.out,
        new AbortController().signal,
      ),
      runCloudStream(
        provider,
        baseReq("y"),
        b.out,
        new AbortController().signal,
      ),
    ]);
    expect(peak).toBe(1);
  });

  it("provider 什么都没说就返回 → 按整次失败处理（不让调用方永远等 done）", async () => {
    const provider = fakeProvider({ async stream() {} });
    const { out, events } = collector();
    await runCloudStream(
      provider,
      baseReq("x"),
      out,
      new AbortController().signal,
    );
    expect(events).toEqual(["error:failed"]);
  });

  it("abort 之后不再补发任何事件", async () => {
    const controller = new AbortController();
    const provider = fakeProvider({
      async stream(_req, sink) {
        sink.chunk(new Float32Array([0]), 24000);
        controller.abort();
        sink.done();
      },
    });
    const { out, events } = collector();
    await runCloudStream(provider, baseReq("x"), out, controller.signal);
    expect(events).toEqual(["chunk:0:24000"]);
  });
});
