/**
 * 手动 / e2e 检查：用**真实**的发布物（`resources/voice-runtime.json`）跑一遍安装器。
 *
 * 默认跳过，只在显式设置 `VOICE_E2E=1` 时运行（要下 ~130MB，不适合进日常套件）：
 *
 *   VOICE_E2E=1 npx vitest run src/tests/speech/installer-real-artifacts.manual.test.ts
 *
 * 装到 `/tmp/voice-install-check`。
 *
 * **最后一步是构造识别器，不是查 `existsSync`** —— 这个区别很实在：首次跑的时候只查
 * 存在性，测试绿了，但 `decoder.onnx` 在引擎眼里是坏的（`Protobuf parsing failed`）。
 * 构造 `OnlineRecognizer` 会真的把三个 ONNX 读进 onnxruntime，坏文件当场就抛。
 * 不需要喂音频：模型加载就发生在构造函数里。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  MODEL_ID,
  RUNTIME_VERSION,
  installModel,
  installRuntime,
  readManifest,
  voiceRoot,
} from "../../main/speech/installer";

const ROOT = "/tmp/voice-install-check";
const ENABLED = process.env.VOICE_E2E === "1";

interface RuntimeSpec {
  modelUrl: string;
  modelSha256: string;
  nodeSha256: string;
  runtimeSha256: Record<string, string>;
}

describe.skipIf(!ENABLED)("installer with real published artifacts", () => {
  it("installs the runtime and the model from the real URLs and records both", async () => {
    rmSync(ROOT, { recursive: true, force: true });
    const spec = JSON.parse(
      readFileSync(
        join(process.cwd(), "resources", "voice-runtime.json"),
        "utf8",
      ),
    ) as RuntimeSpec;
    const key = `${process.platform}-${process.arch}`;
    const runtimeSha256 = spec.runtimeSha256[key];
    expect(runtimeSha256, `no runtime sha256 for ${key}`).toBeTruthy();

    await installRuntime({
      userDataPath: ROOT,
      platform: process.platform === "win32" ? "win" : process.platform,
      arch: process.arch,
      runtimeSha256,
      nodeSha256: spec.nodeSha256,
      onProgress: () => {},
    });
    await installModel({
      userDataPath: ROOT,
      url: spec.modelUrl,
      sha256: spec.modelSha256,
      onProgress: () => {},
    });

    const dir = join(voiceRoot(ROOT), "runtime", RUNTIME_VERSION);
    const modelDir = join(voiceRoot(ROOT), "models", MODEL_ID);
    expect(existsSync(join(dir, "sherpa-onnx-node", "sherpa-onnx.js"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, "sherpa-onnx-node", "addon-static-import.js")),
    ).toBe(true);
    for (const file of [
      "encoder.int8.onnx",
      "decoder.onnx",
      "joiner.int8.onnx",
      "tokens.txt",
      "bpe.model",
    ]) {
      expect(existsSync(join(modelDir, file)), `missing ${file}`).toBe(true);
    }
    expect(readManifest(ROOT)?.runtimeVersion).toBe(RUNTIME_VERSION);
    expect(readManifest(ROOT)?.model).toBe(MODEL_ID);

    // 真正把模型读进 onnxruntime。坏文件（截断、权限、半写完）在这里就会抛，
    // 而 existsSync 永远发现不了。
    const require = createRequire(import.meta.url);
    const sherpa = require(join(dir, "sherpa-onnx-node", "sherpa-onnx.js"));
    expect(() => {
      const recognizer = new sherpa.OnlineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: join(modelDir, "encoder.int8.onnx"),
            decoder: join(modelDir, "decoder.onnx"),
            joiner: join(modelDir, "joiner.int8.onnx"),
          },
          tokens: join(modelDir, "tokens.txt"),
          modelType: "zipformer2",
          bpeVocab: join(modelDir, "bpe.model"),
          numThreads: 2,
          provider: "cpu",
        },
        decodingMethod: "greedy_search",
      });
      expect(recognizer).toBeTruthy();
    }).not.toThrow();
  }, 900_000);
});
