import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enginePaths,
  engineRoot,
  installEngine,
  isEngineInstalled,
  preflightEngine,
} from "../../main/engine/engine-installer";
import type { TtsEngineSpec } from "../../main/speech/runtime-spec";

let server: Server | null = null;
const cleanup: string[] = [];

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  for (const dir of cleanup.splice(0))
    await rm(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/** 造一份"引擎产物" tar.gz（顶层带目录，与 CI 打出来的形状一致）。 */
async function makeArtifact(): Promise<{
  file: string;
  sha256: string;
  bytes: number;
}> {
  const work = tempDir("artifact-src-");
  mkdirSync(join(work, "qwentts-server-6fae929-darwin-arm64", "bin"), {
    recursive: true,
  });
  const root = join(work, "qwentts-server-6fae929-darwin-arm64");
  writeFileSync(join(root, "bin", "tts-server"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  writeFileSync(join(root, "LICENSE"), "MIT\n");
  const file = join(work, "artifact.tar.gz");
  await tar.c({ gzip: true, file, cwd: work }, [
    "qwentts-server-6fae929-darwin-arm64",
  ]);
  const raw = readFileSync(file);
  return {
    file,
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: raw.length,
  };
}

async function serve(files: Record<string, string>): Promise<string> {
  server = createServer((req, res) => {
    const name = (req.url ?? "/").slice(1);
    const path = files[name];
    if (!path) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-length": String(statSync(path).size) });
    res.end(readFileSync(path));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** 组装一份指向本地服务器的清单（体积与哈希都是真的）。 */
async function makeSpec(): Promise<{ spec: TtsEngineSpec; base: string }> {
  const artifact = await makeArtifact();
  const work = tempDir("models-");
  const talkerFile = join(work, "qwen-talker.gguf");
  const tokenizerFile = join(work, "qwen-tokenizer.gguf");
  writeFileSync(talkerFile, Buffer.alloc(2048, 3));
  writeFileSync(tokenizerFile, Buffer.alloc(1024, 4));
  const base = await serve({
    "artifact.tar.gz": artifact.file,
    "qwen-talker.gguf": talkerFile,
    "qwen-tokenizer.gguf": tokenizerFile,
  });
  const hash = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  const spec: TtsEngineSpec = {
    version: "6fae929",
    artifactUrl: { "darwin-arm64": `${base}/artifact.tar.gz` },
    artifactSha256: { "darwin-arm64": artifact.sha256 },
    artifactBytes: { "darwin-arm64": artifact.bytes },
    talkerUrl: `${base}/qwen-talker.gguf`,
    talkerSha256: hash(talkerFile),
    talkerBytes: statSync(talkerFile).size,
    tokenizerUrl: `${base}/qwen-tokenizer.gguf`,
    tokenizerSha256: hash(tokenizerFile),
    tokenizerBytes: statSync(tokenizerFile).size,
  };
  return { spec, base };
}

describe("preflightEngine", () => {
  const spec: TtsEngineSpec = {
    version: "6fae929",
    artifactUrl: { "darwin-arm64": "u" },
    artifactSha256: { "darwin-arm64": "s" },
    artifactBytes: { "darwin-arm64": 1 },
    talkerUrl: "t",
    talkerSha256: "t",
    talkerBytes: 1,
    tokenizerUrl: "k",
    tokenizerSha256: "k",
    tokenizerBytes: 1,
  };

  it("清单里没有这个平台就是 platform", () => {
    const userDataPath = tempDir("ud-");
    expect(
      preflightEngine({ userDataPath, spec, platformKey: "win32-x64" }),
    ).toEqual({ ok: false, reason: "platform" });
  });

  it("磁盘不足是 disk", () => {
    const userDataPath = tempDir("ud-");
    expect(
      preflightEngine({
        userDataPath,
        spec,
        platformKey: "darwin-arm64",
        freeDisk: () => 1024,
      }),
    ).toEqual({ ok: false, reason: "disk" });
  });

  it("内存不足是 memory", () => {
    const userDataPath = tempDir("ud-");
    expect(
      preflightEngine({
        userDataPath,
        spec,
        platformKey: "darwin-arm64",
        freeDisk: () => 100 * 1024 * 1024 * 1024,
        totalMem: () => 8 * 1024 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "memory" });
  });

  it("都够就是 ok", () => {
    const userDataPath = tempDir("ud-");
    expect(
      preflightEngine({
        userDataPath,
        spec,
        platformKey: "darwin-arm64",
        freeDisk: () => 100 * 1024 * 1024 * 1024,
        totalMem: () => 32 * 1024 * 1024 * 1024,
      }),
    ).toEqual({ ok: true });
  });
});

describe("installEngine", () => {
  const preflightOk = {
    freeDisk: () => 100 * 1024 * 1024 * 1024,
    totalMem: () => 32 * 1024 * 1024 * 1024,
  };

  it("装完三件齐 + 预热被调用 + 可执行位在", async () => {
    const userDataPath = tempDir("ud-");
    const { spec } = await makeSpec();
    const warmup = vi.fn(async () => {});
    const percents: number[] = [];

    expect(isEngineInstalled(userDataPath, spec)).toBe(false);
    await installEngine({
      userDataPath,
      spec,
      platformKey: "darwin-arm64",
      onProgress: (p) => percents.push(p),
      warmup,
      ...preflightOk,
    });

    const paths = enginePaths(userDataPath, spec);
    expect(existsSync(paths.bin)).toBe(true);
    expect(existsSync(paths.talker)).toBe(true);
    expect(existsSync(paths.tokenizer)).toBe(true);
    expect(isEngineInstalled(userDataPath, spec)).toBe(true);
    // 半成品不该留下
    expect(existsSync(`${paths.talker}.partial`)).toBe(false);
    expect(warmup).toHaveBeenCalledOnce();
    if (process.platform !== "win32") {
      expect(statSync(paths.bin).mode & 0o111).not.toBe(0);
    }
    expect(percents.at(-1)).toBeCloseTo(1, 5);
  });

  it("预热失败 → 整体回滚，不留半装目录", async () => {
    const userDataPath = tempDir("ud-");
    const { spec } = await makeSpec();

    await expect(
      installEngine({
        userDataPath,
        spec,
        platformKey: "darwin-arm64",
        onProgress: () => {},
        warmup: async () => {
          throw new Error("self check failed");
        },
        ...preflightOk,
      }),
    ).rejects.toThrow("self check failed");

    expect(existsSync(engineRoot(userDataPath, spec.version))).toBe(false);
  });

  it("新版装失败只回滚新版：旧版目录原封不动（版本化的意义）", async () => {
    const userDataPath = tempDir("ud-");
    const { spec } = await makeSpec();
    const installed = { ...spec, version: "v1" };

    // 先装好 v1
    await installEngine({
      userDataPath,
      spec: installed,
      platformKey: "darwin-arm64",
      onProgress: () => {},
      ...preflightOk,
    });
    expect(isEngineInstalled(userDataPath, installed)).toBe(true);

    // 再装 v2，让它失败（sha 对不上）
    const broken = {
      ...spec,
      version: "v2",
      artifactSha256: { "darwin-arm64": "00" },
    };
    await expect(
      installEngine({
        userDataPath,
        spec: broken,
        platformKey: "darwin-arm64",
        onProgress: () => {},
        ...preflightOk,
      }),
    ).rejects.toThrow();

    // v1 还在、还能用；v2 不留半成品
    expect(existsSync(engineRoot(userDataPath, "v2"))).toBe(false);
    expect(isEngineInstalled(userDataPath, installed)).toBe(true);
  });

  it("清单里 sha256 留空 = 还没发布，直接报错不装", async () => {
    const userDataPath = tempDir("ud-");
    const { spec } = await makeSpec();
    const blank = {
      ...spec,
      artifactSha256: { "darwin-arm64": "" },
    };
    await expect(
      installEngine({
        userDataPath,
        spec: blank,
        platformKey: "darwin-arm64",
        onProgress: () => {},
        ...preflightOk,
      }),
    ).rejects.toThrow(/not published/);
  });
});
