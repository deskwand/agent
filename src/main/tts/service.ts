/**
 * @module main/tts/service
 *
 * 引擎的**单例持有者**。IPC 与「给模型的工具」都从这里拿。
 *
 * 现在有**两个**引擎：中文（vits-melo-tts-zh_en）与英文（vits-melo-tts-en）。各自
 * 按需加载、各自只建一次；但加载后内存都不归还（原生 addon 没有释放接口），
 * 所以设置卡片里那句「关掉开关要重启应用才归还」是真的，不是保守说法。
 */
import { join } from "node:path";
import type { TtsModelKey, TtsSpeakResult } from "../../shared/ipc-types";
import type { TtsEngine } from "./tts-engine";
import { createLocalTtsEngine, loadSherpaTts } from "./local-engine";
import { expandEnglishNumbers } from "./english-numbers";
import { pickEngine } from "./route";
import {
  TTS_ENGLISH_MODEL_ID,
  TTS_MODEL_ID,
  readManifest,
  voiceRoot,
} from "../speech/installer";
import { log, logError } from "../utils/logger";

export interface TtsServiceDeps {
  userDataPath: string;
  /** 注入以便测试。默认：真实运行时目录 + 真引擎。 */
  createEngine?: (engine: TtsModelKey) => TtsEngine;
}

export interface TtsService {
  /** 按引擎判：只装英文也能朗读英文。参数默认 "zh" 保留既有调用点的语义。 */
  isInstalled(engine?: TtsModelKey): boolean;
  /** 加载模型（幂等）。安装后自检也用它。 */
  load(engine?: TtsModelKey): Promise<void>;
  speak(text: string, opts?: { engine?: TtsModelKey }): Promise<TtsSpeakResult>;
}

const MODEL_ID_BY_ENGINE: Record<TtsModelKey, string> = {
  zh: TTS_MODEL_ID,
  en: TTS_ENGLISH_MODEL_ID,
};

const MANIFEST_KEY_BY_ENGINE: Record<
  TtsModelKey,
  "ttsModel" | "ttsEnglishModel"
> = {
  zh: "ttsModel",
  en: "ttsEnglishModel",
};

let cached: { userDataPath: string; service: TtsService } | null = null;

/** 测试用：清掉缓存，免得用例之间互相带状态。 */
export function resetTtsServiceCache(): void {
  cached = null;
}

export function getTtsService(deps: TtsServiceDeps): TtsService {
  // 同一个 userDataPath 只能有一个实例：第二个实例会再加载一份模型。
  if (cached?.userDataPath === deps.userDataPath) return cached.service;

  const engines = new Map<TtsModelKey, TtsEngine>();

  const isInstalled = (engine: TtsModelKey = "zh") =>
    readManifest(deps.userDataPath)?.[MANIFEST_KEY_BY_ENGINE[engine]] ===
    MODEL_ID_BY_ENGINE[engine];

  const realEngine = (engine: TtsModelKey): TtsEngine => {
    const version = readManifest(deps.userDataPath)?.runtimeVersion ?? "";
    const runtime = loadSherpaTts(
      join(voiceRoot(deps.userDataPath), "runtime", version),
    );
    return createLocalTtsEngine({
      modelDir: join(
        voiceRoot(deps.userDataPath),
        "models",
        MODEL_ID_BY_ENGINE[engine],
      ),
      variant: engine,
      createTts: (config) => new runtime.OfflineTts(config),
      createGenerationConfig: (options) =>
        new runtime.GenerationConfig(options),
    });
  };

  const getEngine = (engine: TtsModelKey): TtsEngine => {
    const existing = engines.get(engine);
    if (existing) return existing;
    const created = deps.createEngine
      ? deps.createEngine(engine)
      : realEngine(engine);
    engines.set(engine, created);
    return created;
  };

  const service: TtsService = {
    isInstalled,
    async load(engine: TtsModelKey = "zh") {
      if (!isInstalled(engine)) throw new Error("tts model not installed");
      const tts = getEngine(engine);
      if (tts.isLoaded()) return;
      log(`[Tts] loading model (cold start): ${engine}`);
      await tts.load();
    },
    async speak(text, opts) {
      if (!text.trim()) return { ok: false, error: "empty text" };

      // 1) 先按**原始文本**路由。数字转写会改变字母集合，必须先路由再转写
      //    （否则 "12" 变成 "twelve" 之后就成英文了）。
      const routed = pickEngine(text);
      // 2) 显式指定（自检用）就听它；否则该引擎没装才退回中文。
      const engine: TtsModelKey =
        opts?.engine ?? (isInstalled(routed) ? routed : "zh");
      if (!isInstalled(engine))
        return { ok: false, error: "model not installed" };

      // 3) 只有英文路径做数字转写：中文路径有模型自带的 .fst，英文包一个都没有。
      const spoken = engine === "en" ? expandEnglishNumbers(text) : text;

      try {
        await service.load(engine);
        const audio = await getEngine(engine).synthesize(spoken);
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
