/**
 * @module main/tts/service
 *
 * 引擎的**单例持有者**。IPC 与「给模型的工具」都从这里拿 —— 两个实例就是两份
 * 模型常驻内存（实测 +324MB × 2），而且两次冷启动。
 *
 * 加载后内存不归还（原生 addon 没有释放接口），所以设置卡片里那句
 * 「关掉开关要重启应用才归还」是真的，不是保守说法。
 */
import { join } from "node:path";
import type { TtsSpeakResult } from "../../shared/ipc-types";
import type { TtsEngine } from "./tts-engine";
import { createLocalTtsEngine, loadSherpaTts } from "./local-engine";
import { TTS_MODEL_ID, readManifest, voiceRoot } from "../speech/installer";
import { log, logError } from "../utils/logger";

export interface TtsServiceDeps {
  userDataPath: string;
  /** 注入以便测试。默认：真实运行时目录 + 真引擎。 */
  createEngine?: () => TtsEngine;
}

export interface TtsService {
  isInstalled(): boolean;
  /** 加载模型（幂等）。安装后自检也用它 —— 见 Task 11。 */
  load(): Promise<void>;
  speak(text: string): Promise<TtsSpeakResult>;
}

let cached: { userDataPath: string; service: TtsService } | null = null;

/** 测试用：清掉缓存，免得用例之间互相带状态。 */
export function resetTtsServiceCache(): void {
  cached = null;
}

export function getTtsService(deps: TtsServiceDeps): TtsService {
  // 同一个 userDataPath 只能有一个实例：第二个实例会再加载一份模型。
  if (cached?.userDataPath === deps.userDataPath) return cached.service;

  let engine: TtsEngine | null = null;

  const isInstalled = () =>
    readManifest(deps.userDataPath)?.ttsModel === TTS_MODEL_ID;

  const getEngine = (): TtsEngine => {
    if (engine) return engine;
    if (deps.createEngine) {
      engine = deps.createEngine();
      return engine;
    }
    const version = readManifest(deps.userDataPath)?.runtimeVersion ?? "";
    const runtime = loadSherpaTts(
      join(voiceRoot(deps.userDataPath), "runtime", version),
    );
    engine = createLocalTtsEngine({
      modelDir: join(voiceRoot(deps.userDataPath), "models", TTS_MODEL_ID),
      createTts: (config) => new runtime.OfflineTts(config),
      createGenerationConfig: (options) =>
        new runtime.GenerationConfig(options),
    });
    return engine;
  };

  const service: TtsService = {
    isInstalled,
    async load() {
      if (!isInstalled()) throw new Error("tts model not installed");
      const tts = getEngine();
      if (tts.isLoaded()) return;
      log("[Tts] loading model (cold start)");
      await tts.load();
    },
    async speak(text) {
      if (!text.trim()) return { ok: false, error: "empty text" };
      if (!isInstalled()) return { ok: false, error: "model not installed" };
      try {
        await service.load();
        const audio = await getEngine().synthesize(text);
        return {
          ok: true,
          samples: audio.samples,
          sampleRate: audio.sampleRate,
        };
      } catch (error) {
        logError("[Tts] synthesize failed:", error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  cached = { userDataPath: deps.userDataPath, service };
  return service;
}
