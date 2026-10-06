/**
 * @module main/tts/service
 *
 * 引擎的**单例持有者**。IPC 与「给模型的工具」都从这里拿。
 *
 * 现在有**三个**引擎：中文（vits-melo-tts-zh_en）、英文（vits-melo-tts-en），
 * 以及语音模式的高速音色（matcha-icefall-zh-en）。各自按需加载、各自只建一次；
 * 但加载后内存都不归还（原生 addon 没有释放接口），
 * 所以设置卡片里那句「关掉开关要重启应用才归还」是真的，不是保守说法。
 */
import { join } from "node:path";
import type {
  TtsModelKey,
  TtsSpeakOptions,
  TtsSpeakResult,
} from "../../shared/ipc-types";
import type { TtsEngine, SynthesizedAudio } from "./tts-engine";
import { createLocalTtsEngine, loadSherpaTts } from "./local-engine";
import { expandEnglishNumbers } from "./english-numbers";
import { pickEngine } from "./route";
import {
  TTS_ENGLISH_MODEL_ID,
  TTS_FAST_MODEL_ID,
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
  /**
   * 合成一句。给了 `onChunk` 就把引擎的分段块交给它（返回 `false` 中止后续分段）。
   */
  speak(
    text: string,
    opts?: TtsSpeakOptions,
    onChunk?: (chunk: SynthesizedAudio) => boolean | void,
  ): Promise<TtsSpeakResult>;
}

const MODEL_ID_BY_ENGINE: Record<TtsModelKey, string> = {
  zh: TTS_MODEL_ID,
  en: TTS_ENGLISH_MODEL_ID,
  matcha: TTS_FAST_MODEL_ID,
};

const MANIFEST_KEY_BY_ENGINE: Record<
  TtsModelKey,
  "ttsModel" | "ttsEnglishModel" | "ttsFastModel"
> = {
  zh: "ttsModel",
  en: "ttsEnglishModel",
  matcha: "ttsFastModel",
};

/**
 * 一次调用最终会用哪个引擎。**只有这一处**。
 *
 * ipc 那道日志开关的门控也要问同一个问题（"这次会用朗读的模型吗"），两处各写一遍
 * 就会各写一遍地错：`{ prefer: "matcha", engine: "zh" }` 时门控以为要用 matcha
 * 而实际用的是 zh，于是关着开关也照念朗读模型。
 */
export function resolveTtsEngine(
  text: string,
  opts: TtsSpeakOptions | undefined,
  isInstalled: (engine?: TtsModelKey) => boolean,
): TtsModelKey {
  // 1) 先按**原始文本**路由。数字转写会改变字母集合，必须先路由再转写
  //    （否则 "12" 变成 "twelve" 之后就成英文了）。
  const routed = pickEngine(text);
  // 2) engine 是硬指定（自检）：没装也会返回它，由调用方报错，绝不回退。
  if (opts?.engine) return opts.engine;
  // 3) prefer 是软偏好（语音模式）：装了才用，没装就走路由。
  if (opts?.prefer && isInstalled(opts.prefer)) return opts.prefer;
  // 4) 路由的那个也没装就退回 "zh" —— 同样由调用方那道 isInstalled 报错。
  return isInstalled(routed) ? routed : "zh";
}

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
    async speak(text, opts, onChunk) {
      if (!text.trim()) return { ok: false, error: "empty text" };

      // 引擎选择只有一处规则，见 resolveTtsEngine 的注释。
      const engine = resolveTtsEngine(text, opts, isInstalled);
      if (!isInstalled(engine))
        return { ok: false, error: "model not installed" };

      // 只有英文路径做数字转写：中文路径有模型自带的 .fst，英文包一个都没有。
      // matcha 自带三个 -zh.fst，所以它和中文路径一样直接送原文。
      const spoken = engine === "en" ? expandEnglishNumbers(text) : text;

      try {
        await service.load(engine);
        const audio = await getEngine(engine).synthesize(spoken, onChunk);
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
