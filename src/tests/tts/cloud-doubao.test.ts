import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  getCloudProvider,
  runCloudStream,
  type SpeechOut,
} from "../../main/tts/cloud";
import { splitJsonFrames } from "../../main/tts/cloud/providers/doubao";

describe("splitJsonFrames（JSON 流的分帧）", () => {
  it("一条流里多个对象", () => {
    const { frames, rest } = splitJsonFrames('{"a":1}{"b":2}');
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe("");
  });

  it("对象被切在两块中间：残片留到下一次", () => {
    const first = splitJsonFrames('{"code":0,"data":"ab');
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe('{"code":0,"data":"ab');
    const second = splitJsonFrames(first.rest + 'c="}{"code":0}');
    expect(second.frames).toEqual(['{"code":0,"data":"abc="}', '{"code":0}']);
    expect(second.rest).toBe("");
  });

  it("字符串里的花括号不算结构", () => {
    const { frames } = splitJsonFrames('{"message":"a{b}c","data":null}');
    expect(frames).toEqual(['{"message":"a{b}c","data":null}']);
  });
});

/** 假豆包端点：JSON 流 + base64 音频，且**故意把一个对象切在两次 write 之间**。 */
function fakeDoubao(
  seen: {
    headers: Record<string, unknown>[];
    bodies: string[];
  },
  /** 回一帧错误而不是音频（用来复现「音色与资源代际不匹配」）。 */
  errorFrame?: { code: number; message: string },
) {
  return createServer((req, res) => {
    seen.headers.push(req.headers as Record<string, unknown>);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.bodies.push(body);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      if (errorFrame) {
        res.write(JSON.stringify(errorFrame));
        res.end();
        return;
      }
      const audio = Buffer.alloc(2400, 2); // 2400 字节 = 1200 个 s16le 样本
      const frame = JSON.stringify({
        code: 0,
        message: "",
        data: audio.toString("base64"),
      });
      const half = Math.floor(frame.length / 2);
      res.write(frame.slice(0, half)); // 切在 JSON 中间
      setTimeout(() => {
        res.write(frame.slice(half));
        res.write(frame);
        res.write(
          JSON.stringify({ code: 20000000, message: "ok", data: null }),
        );
        res.end();
      }, 10);
    });
  });
}

let server: ReturnType<typeof fakeDoubao> | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

describe("doubao 适配器", () => {
  it("三档映射到 standard / expressive", () => {
    const provider = getCloudProvider("doubao")!;
    expect(provider.tierModels("fast")).toBe("seed-tts-2.0-standard");
    expect(provider.tierModels("balanced")).toBe("seed-tts-2.0-standard");
    expect(provider.tierModels("best")).toBe("seed-tts-2.0-expressive");
  });

  it("按官方协议发鉴权头与请求体，base64 音频解成 PCM，最后 done", async () => {
    const seen = {
      headers: [] as Record<string, unknown>[],
      bodies: [] as string[],
    };
    server = fakeDoubao(seen);
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", () => resolve()),
    );
    const { port } = server!.address() as { port: number };

    const events: string[] = [];
    let samples = 0;
    const out: SpeechOut = {
      chunk: (chunk, sampleRate, seq) => {
        samples += chunk.length;
        events.push(`chunk:${seq}:${sampleRate}`);
      },
      done: () => events.push("done"),
      error: (code) => events.push(`error:${code}`),
    };
    await runCloudStream(
      getCloudProvider("doubao")!,
      {
        text: "自检句",
        voiceId: "zh_female_vv_uranus_bigtts",
        model: "seed-tts-2.0-standard",
        credentials: { apiKey: "test-key" },
        baseUrl: `http://127.0.0.1:${port}`,
      },
      out,
      new AbortController().signal,
    );

    expect(seen.headers[0]["x-api-key"]).toBe("test-key");
    expect(seen.headers[0]["x-api-resource-id"]).toBe("seed-tts-2.0");
    const sent = JSON.parse(seen.bodies[0]) as {
      req_params: {
        text: string;
        speaker: string;
        audio_params: { format: string };
      };
    };
    expect(sent.req_params.text).toBe("自检句");
    expect(sent.req_params.speaker).toBe("zh_female_vv_uranus_bigtts");
    expect(sent.req_params.audio_params.format).toBe("pcm");

    // 两帧音频（有一帧被切成两半，跨块拼回来的）→ 2400 个样本
    expect(samples).toBe(2400);
    expect(events[0]).toBe("chunk:0:24000");
    expect(events.at(-1)).toBe("done");
  });

  it("55000000（音色与资源不匹配）→ failed，且说明该换 2.0 音色", async () => {
    const seen = {
      headers: [] as Record<string, unknown>[],
      bodies: [] as string[],
    };
    server = fakeDoubao(seen, {
      code: 55000000,
      message: "resource ID is mismatched with speaker related resource",
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", () => resolve()),
    );
    const { port } = server!.address() as { port: number };
    const events: string[] = [];
    const out: SpeechOut = {
      chunk: () => {},
      done: () => events.push("done"),
      error: (code, detail) => events.push(`error:${code}:${detail ?? ""}`),
    };
    await runCloudStream(
      getCloudProvider("doubao")!,
      {
        text: "你好",
        // 1.0 代音色（_moon_/_mars_）配 seed-tts-2.0 就是这颗雷
        voiceId: "zh_male_beijingxiaoye_moon_bigtts",
        model: "seed-tts-2.0-standard",
        credentials: { apiKey: "k" },
        baseUrl: `http://127.0.0.1:${port}`,
      },
      out,
      new AbortController().signal,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(/^error:failed:/);
    expect(events[0]).toContain("seed-tts-2.0");
  });

  it("缺 key → unconfigured", async () => {
    const seen: string[] = [];
    const out: SpeechOut = {
      chunk: () => {},
      done: () => {},
      error: (code) => seen.push(code),
    };
    await runCloudStream(
      getCloudProvider("doubao")!,
      {
        text: "x",
        voiceId: "v",
        model: "seed-tts-2.0-standard",
        credentials: {},
      },
      out,
      new AbortController().signal,
    );
    expect(seen).toEqual(["unconfigured"]);
  });
});
