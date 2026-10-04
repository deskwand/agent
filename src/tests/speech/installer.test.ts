import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  MODEL_ID,
  RUNTIME_VERSION,
  TTS_ENGLISH_MODEL_ID,
  TTS_MODEL_ID,
  installModel,
  installTtsModel,
  readManifest,
  removeTtsModel,
  removeVoiceModel,
  voiceRoot,
} from "../../main/speech/installer";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "voice-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/** 造一个最小 .tar.gz（ustar，单个文件），避免测试联网。 */
function tarGz(name: string, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8); // mode
  header.write("0000000\0", 108, 8); // uid
  header.write("0000000\0", 116, 8); // gid
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12); // size
  header.write("00000000000\0", 136, 12); // mtime
  header.write("        ", 148, 8); // checksum 占位
  header.write("0", 156, 1); // typeflag = 普通文件
  header.write("ustar\0", 257, 6);
  header.write("00", 263, 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  const end = Buffer.alloc(1024);
  return gzipSync(Buffer.concat([header, padded, end]));
}

describe("voiceRoot", () => {
  it("lives under userData so nothing ships in the installer", () => {
    expect(voiceRoot("/u")).toBe("/u/voice");
  });
});

describe("installModel", () => {
  it("downloads, verifies, extracts and records a manifest", async () => {
    const archive = tarGz("tokens.txt", "hello");
    const digest = createHash("sha256").update(archive).digest("hex");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(archive), { status: 200 })),
    );

    await installModel({
      userDataPath: root,
      url: "https://example.test/model.tar.gz",
      sha256: digest,
      onProgress: () => {},
    });

    expect(
      existsSync(join(voiceRoot(root), "models", MODEL_ID, "tokens.txt")),
    ).toBe(true);
    expect(readManifest(root)?.model).toBe(MODEL_ID);
  });

  it("refuses a download whose sha256 does not match, and leaves nothing behind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(tarGz("tokens.txt", "hello")), {
            status: 200,
          }),
      ),
    );

    await expect(
      installModel({
        userDataPath: root,
        url: "https://example.test/model.tar.gz",
        sha256: "0".repeat(64),
        onProgress: () => {},
      }),
    ).rejects.toThrow(/sha256/i);

    expect(existsSync(join(voiceRoot(root), "models", MODEL_ID))).toBe(false);
  });

  it("reports progress from 0 to 100", async () => {
    const archive = tarGz("a", "b");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(archive), {
            status: 200,
            headers: { "content-length": String(archive.length) },
          }),
      ),
    );
    const seen: number[] = [];

    await installModel({
      userDataPath: root,
      url: "https://example.test/model.tar.gz",
      sha256: createHash("sha256").update(archive).digest("hex"),
      onProgress: (percent) => seen.push(percent),
    });

    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
    expect(seen.every((p) => p >= 0 && p <= 100)).toBe(true);
  });
});

describe("installTtsModel", () => {
  it("records the tts model without touching the voice model", async () => {
    const archive = tarGz("model.onnx", "weights");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(archive), { status: 200 })),
    );

    await installTtsModel({
      userDataPath: root,
      model: TTS_MODEL_ID,
      url: "https://example.test/tts.tar.gz",
      sha256: createHash("sha256").update(archive).digest("hex"),
      onProgress: () => {},
    });

    const manifest = readManifest(root);
    expect(manifest?.ttsModel).toBe(TTS_MODEL_ID);
    // 朗读的安装不许写坏语音输入那一栏
    expect(manifest?.model ?? "").toBe("");
    expect(
      existsSync(join(voiceRoot(root), "models", TTS_MODEL_ID, "model.onnx")),
    ).toBe(true);
  });

  it("reads a legacy manifest that has no ttsModel field", () => {
    mkdirSync(voiceRoot(root), { recursive: true });
    writeFileSync(
      join(voiceRoot(root), "install.json"),
      JSON.stringify({
        runtimeVersion: RUNTIME_VERSION,
        model: MODEL_ID,
        installedAt: "x",
      }),
    );

    expect(readManifest(root)?.ttsModel).toBeUndefined();
    expect(readManifest(root)?.model).toBe(MODEL_ID);
  });
});

describe("removal", () => {
  it("removing the tts model leaves the runtime and the voice model alone", () => {
    mkdirSync(join(voiceRoot(root), "runtime", RUNTIME_VERSION), {
      recursive: true,
    });
    mkdirSync(join(voiceRoot(root), "models", TTS_MODEL_ID), {
      recursive: true,
    });
    mkdirSync(join(voiceRoot(root), "models", MODEL_ID), { recursive: true });

    removeTtsModel(root, TTS_MODEL_ID);

    expect(existsSync(join(voiceRoot(root), "models", TTS_MODEL_ID))).toBe(
      false,
    );
    expect(existsSync(join(voiceRoot(root), "models", MODEL_ID))).toBe(true);
    expect(existsSync(join(voiceRoot(root), "runtime", RUNTIME_VERSION))).toBe(
      true,
    );
  });

  it("removing the voice model still leaves the runtime (read-aloud shares it)", () => {
    mkdirSync(join(voiceRoot(root), "runtime", RUNTIME_VERSION), {
      recursive: true,
    });
    mkdirSync(join(voiceRoot(root), "models", MODEL_ID), { recursive: true });

    removeVoiceModel(root);

    expect(existsSync(join(voiceRoot(root), "models", MODEL_ID))).toBe(false);
    expect(existsSync(join(voiceRoot(root), "runtime", RUNTIME_VERSION))).toBe(
      true,
    );
  });
});

describe("english model install and removal", () => {
  it("writes the English model into its own manifest field", async () => {
    const archive = tarGz("tokens.txt", "hello");
    const digest = createHash("sha256").update(archive).digest("hex");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(archive), { status: 200 })),
    );

    await installTtsModel({
      userDataPath: root,
      url: "https://example.test/en.tar.gz",
      sha256: digest,
      model: TTS_ENGLISH_MODEL_ID,
      onProgress: () => {},
    });

    expect(readManifest(root)?.ttsEnglishModel).toBe(TTS_ENGLISH_MODEL_ID);
    expect(readManifest(root)?.ttsModel).toBeUndefined();
  });

  it("removes only the requested model", () => {
    mkdirSync(join(voiceRoot(root), "models", TTS_MODEL_ID), {
      recursive: true,
    });
    mkdirSync(join(voiceRoot(root), "models", TTS_ENGLISH_MODEL_ID), {
      recursive: true,
    });
    writeFileSync(
      join(voiceRoot(root), "install.json"),
      JSON.stringify({
        runtimeVersion: RUNTIME_VERSION,
        model: MODEL_ID,
        ttsModel: TTS_MODEL_ID,
        ttsEnglishModel: TTS_ENGLISH_MODEL_ID,
        installedAt: "x",
      }),
    );

    removeTtsModel(root, TTS_ENGLISH_MODEL_ID);

    expect(readManifest(root)?.ttsEnglishModel).toBeUndefined();
    expect(readManifest(root)?.ttsModel).toBe(TTS_MODEL_ID);
    expect(
      existsSync(join(voiceRoot(root), "models", TTS_ENGLISH_MODEL_ID)),
    ).toBe(false);
    expect(existsSync(join(voiceRoot(root), "models", TTS_MODEL_ID))).toBe(
      true,
    );
  });
});
