/**
 * @module main/tts/ipc
 *
 * 朗读的通道：**按模型**安装 + 按句合成。
 *
 * 与语音输入**分开注册**（`voice.*` / `tts.*`）：开关、安装状态、引擎生命周期各自
 * 独立，只有磁盘上的目录与运行时是共享的。合成一个模块会让「关掉语音」与
 * 「关掉朗读」纠缠在一起。
 *
 * 两个模型（中文 zh / 英文 en）各有各的状态与守卫：中文已装**不能**把英文的安装
 * 挡在门外（否则英文行的按钮会静默无反应），英文自检失败也只撤英文那一个。
 *
 * 现在是**三个**：再加上语音模式的高速音色（`matcha`）。它同样各管各的，但它不归
 * 朗读开关管 —— 那道门控的判据见 `tts.speak` 里的注释与设计 D7。
 *
 * D7 后来被 `design-docs/2026-10-06-语音对话音色两档.md` 放宽了一处：语音对话选
 * 「均衡」时用的是中文音色（与朗读共用同一份），它不该被朗读开关拦在门外。
 */
import type { IpcMain } from "electron";
import type {
  TtsEvent,
  TtsInstallState,
  TtsInstallStates,
  TtsModelKey,
  TtsSpeakOptions,
  TtsSpeakResult,
  TtsSpeakStreamResult,
  TtsStreamEvent,
  TtsTone,
} from "../../shared/ipc-types";
import type { TtsService } from "./service";
import { getTtsService, resolveTtsEngine } from "./service";
import {
  TTS_ENGLISH_MODEL_ID,
  TTS_FAST_MODEL_ID,
  TTS_MODEL_ID,
  installRuntime,
  installTtsModel,
  readManifest,
  removeTtsModel,
  type TtsModelId,
} from "../speech/installer";
import { readRuntimeSpec, runtimeKey } from "../speech/runtime-spec";
import { configStore } from "../config/config-store";
import { log, logError } from "../utils/logger";
import type { EngineHost } from "../engine/engine-host";
import { getEngineHost } from "../engine/engine-host";
import {
  ENGINE_VOICE_DEFAULT,
  type EngineInstallState,
} from "../../shared/engine-install";

export interface TtsIpcDeps {
  userDataPath: string;
  sendEvent: (event: TtsEvent) => void;
  /**
   * 流式朗读的块事件。与 sendEvent 分开：块频率高、载荷大，不该吵醒安装进度的订阅者。
   * 目标窗口由接线方决定（照抄 sendEvent 的做法）。
   */
  sendStream: (event: TtsStreamEvent) => void;
  /** 注入以便测试。默认 getTtsService(...)。 */
  service?: TtsService;
  /** 注入以便测试。默认 getEngineHost(userDataPath)（最佳音质档的引擎门面）。 */
  engine?: EngineHost;
  /** 注入以便测试。默认：读随包清单 + 真实下载。 */
  installDeps?: {
    readSpec: typeof readRuntimeSpec;
    installRuntime: typeof installRuntime;
    installTtsModel: typeof installTtsModel;
    removeTtsModel: typeof removeTtsModel;
  };
}

export interface TtsIpcHandle {
  dispose(): void;
}

const CHANNELS = [
  "tts.getInstallState",
  "tts.install",
  "tts.removeInstall",
  "tts.speak",
  "tts.speakStream",
  "tts.cancelStream",
  "tts.preview",
  "tts.getEngineState",
  "tts.installEngine",
  "tts.removeEngine",
] as const;

/** 试听句：三档都是中文音色，所以一句话够用。产物只播不落盘。 */
const PREVIEW_TEXT = "你好，我是本地语音入口。"; // i18n-allow-cjk 试听用语

const MODELS: TtsModelKey[] = ["zh", "en", "matcha"];
const TONES: TtsTone[] = ["fast", "balanced", "best"];

const MODEL_ID_BY_KEY: Record<TtsModelKey, TtsModelId> = {
  zh: TTS_MODEL_ID,
  en: TTS_ENGLISH_MODEL_ID,
  matcha: TTS_FAST_MODEL_ID,
};

/**
 * 自检句与引擎都**显式指定**，不走路由：自检要验证"这个模型能不能出声"，
 * 判定规则一变它就会测到别人身上去。
 */
const SELF_CHECK: Record<TtsModelKey, { text: string; engine: TtsModelKey }> = {
  zh: { text: "语音引擎自检。", engine: "zh" }, // i18n-allow-cjk 自检用语，产物丢弃，不给用户看
  en: { text: "This is a test.", engine: "en" },
  // 句子里刻意带数字与英文词：
  // 数字走三个 -zh.fst，英文走 espeak-ng-data。后者缺失时**不报错**（只静默丢词），
  // 但缺得更彻底（比如整个 dataDir 没了）时原生层会在合成时 exit 255 ——
  // 那时候应该在**安装时**就崩掉，而不是等用户说第一句英文。
  matcha: {
    text: "语音引擎自检，共 12 个字。English too.", // i18n-allow-cjk 同上
    engine: "matcha",
  },
};

export function registerTtsIpc({
  ipcMain,
  deps,
}: {
  ipcMain: IpcMain;
  deps: TtsIpcDeps;
}): TtsIpcHandle {
  const { userDataPath, sendEvent, sendStream } = deps;
  const service = deps.service ?? getTtsService({ userDataPath });
  const engine = deps.engine ?? getEngineHost(userDataPath);
  const installer = {
    readSpec: readRuntimeSpec,
    installRuntime,
    installTtsModel,
    removeTtsModel,
    ...deps.installDeps,
  };

  const engineIdle: EngineInstallState = {
    phase: "idle",
    percent: 0,
    installed: false,
  };
  let engineState: EngineInstallState = { ...engineIdle };
  let engineInstalling = false;
  const publishEngine = (next: EngineInstallState) => {
    engineState = next;
    sendEvent({ type: "engine", state: next });
  };
  /** 音色取自配置（设置页写入），缺省 vivian —— 没选过也要有声音。 */
  const engineVoice = () =>
    configStore.getAll().voiceMode?.voiceEngineVoice ?? ENGINE_VOICE_DEFAULT;

  const idle: TtsInstallState = { phase: "idle", percent: 0, installed: false };
  const states: TtsInstallStates = {
    zh: { ...idle },
    en: { ...idle },
    matcha: { ...idle },
  };
  const installing: Record<TtsModelKey, boolean> = {
    zh: false,
    en: false,
    matcha: false,
  };

  const publish = (model: TtsModelKey, next: TtsInstallState) => {
    states[model] = next;
    sendEvent({ type: "install", model, state: next });
  };

  /**
   * 朗读开关的门控。**两个 handler 共用**，不许各写一份：判据必须与
   * `resolveTtsEngine` 的最终结果一致，否则 `{ prefer: "matcha", engine: "zh" }`
   * 这类入参会判错。返回错误字符串表示拦下。
   *
   * 每个模型有自己的归属：zh / en 属于朗读，那个开关是**朗读那条路**的总闸；
   * matcha 属于语音模式。语音对话（`purpose === "voice"`）是例外：它在设置里
   * 明确选了音色，那份模型就是为它而下的，不该被朗读开关拦在门外。
   */
  const readAloudGate = (
    text: string,
    opts?: TtsSpeakOptions,
  ): string | null => {
    const engineForCall = resolveTtsEngine(text, opts, (engine) =>
      service.isInstalled(engine),
    );
    if (
      !configStore.getAll().readAloud?.enabled &&
      engineForCall !== "matcha" &&
      opts?.purpose !== "voice"
    ) {
      return "read aloud disabled";
    }
    return null;
  };

  /**
   * 运行时被语音输入与朗读共享，缺了就装 —— 两个模型都走它，所以只装英文的
   * 新用户也能拿到运行时。
   *
   * **并发只允许一次在飞**：两个模型同时开始安装时（首次使用、两行都点），
   * 两次 installRuntime 会往同一个目录解包，而下载器的临时文件名按毫秒生成，
   * 后到的那个会在前者解包时删掉临时文件。所以这里共用一个 promise；
   * 进度只报给第一个调用者，第二个在自己的模型下载开始时接着报。
   */
  let runtimeInstall: Promise<void> | null = null;

  const ensureRuntime = async (
    onProgress: (percent: number) => void,
    onPhase: (phase: "downloading" | "extracting") => void,
  ) => {
    if (readManifest(userDataPath)?.runtimeVersion) return;
    runtimeInstall ??= installer
      .installRuntime({
        userDataPath,
        platform: runtimeKey().split("-")[0],
        arch: runtimeKey().split("-")[1],
        runtimeSha256: installer.readSpec().runtimeSha256[runtimeKey()],
        nodeSha256: installer.readSpec().nodeSha256,
        onProgress,
        onPhase,
      })
      .catch((error: unknown) => {
        runtimeInstall = null; // 失败要允许重试
        throw error;
      });
    await runtimeInstall;
  };

  ipcMain.handle("tts.getInstallState", () => ({
    zh: { ...states.zh, installed: service.isInstalled("zh") },
    en: { ...states.en, installed: service.isInstalled("en") },
    matcha: { ...states.matcha, installed: service.isInstalled("matcha") },
  }));

  ipcMain.handle("tts.install", async (_event, model: TtsModelKey) => {
    // 守卫**按模型**：中文已装不能把英文的安装挡在门外
    if (
      !MODELS.includes(model) ||
      installing[model] ||
      service.isInstalled(model)
    ) {
      return;
    }
    installing[model] = true;
    const onProgress = (percent: number) =>
      publish(model, { phase: "downloading", percent, installed: false });
    const onPhase = (phase: "downloading" | "extracting") =>
      publish(model, { phase, percent: 100, installed: false });
    try {
      const spec = installer.readSpec();
      // 一张表而不是嵌套三元：三个模型后三元式已经读不动了
      const sources: Record<TtsModelKey, { url: string; sha256: string }> = {
        zh: { url: spec.ttsModelUrl, sha256: spec.ttsModelSha256 },
        en: {
          url: spec.ttsEnglishModelUrl,
          sha256: spec.ttsEnglishModelSha256,
        },
        matcha: { url: spec.ttsFastModelUrl, sha256: spec.ttsFastModelSha256 },
      };
      const target = { id: MODEL_ID_BY_KEY[model], ...sources[model] };
      publish(model, { phase: "downloading", percent: 0, installed: false });
      await ensureRuntime(onProgress, onPhase);
      publish(model, { phase: "downloading", percent: 0, installed: false });
      await installer.installTtsModel({
        userDataPath,
        url: target.url,
        sha256: target.sha256,
        model: target.id,
        onProgress,
        onPhase,
      });
      // 装完立刻加载模型并合成一句：平台不兼容 / 文件不全要在**安装时**暴露，
      // 不能等用户点朗读才发现（本地引擎是唯一通路，没有云端兜底）。
      const check = SELF_CHECK[model];
      const selfCheck = await service.speak(check.text, {
        engine: check.engine,
      });
      if (!selfCheck.ok) {
        // 自检失败就把刚装的那一个撤掉。否则清单里写着「已装」，重试会被
        // isInstalled() 挡在门外 —— 用户既用不了朗读，也没有任何入口修它。
        installer.removeTtsModel(userDataPath, target.id);
        throw new Error(selfCheck.error);
      }
      publish(model, { phase: "ready", percent: 100, installed: true });
    } catch (error) {
      logError(`[Tts] install failed (${model}):`, error);
      publish(model, {
        phase: "error",
        percent: 0,
        installed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      installing[model] = false;
    }
  });

  ipcMain.handle("tts.removeInstall", (_event, model: TtsModelKey) => {
    if (!MODELS.includes(model)) return;
    // 模型 → 目录名是常量映射，不必为了删东西去读随包清单
    installer.removeTtsModel(userDataPath, MODEL_ID_BY_KEY[model]);
    // 引擎常驻内存、没有卸载接口 —— 只能重启才归还。不要假装已释放。
    publish(model, { phase: "idle", percent: 0, installed: false });
  });

  ipcMain.handle(
    "tts.speak",
    async (
      _event,
      text: string,
      opts?: TtsSpeakOptions,
    ): Promise<TtsSpeakResult> => {
      const blocked = readAloudGate(text, opts);
      if (blocked) return { ok: false, error: blocked };
      return service.speak(text, opts);
    },
  );

  let nextStreamId = 1;
  /** 已请求取消的流。`onProgress` **同步**查它 —— 那儿不能 await IPC。 */
  const cancelled = new Set<number>();
  /** 在飞的流。用它把「取消一个不存在的流」挡在外面：`cancelled` 的清理挂在流
   *  自己的 finally 上，给一个不存在的 id 登记就是永不回收的一项。 */
  const live = new Set<number>();

  /** 在飞的引擎流：`tts.cancelStream` 要能 abort 掉对应的那次 fetch。 */
  const engineAborts = new Map<number, AbortController>();

  const runStream = async (
    streamId: number,
    text: string,
    opts?: TtsSpeakOptions,
  ): Promise<void> => {
    const blocked = readAloudGate(text, opts);
    if (blocked) {
      sendStream({ streamId, type: "error", error: blocked });
      return;
    }

    // 「最佳音质」档：先判可用性，再走引擎。不可用就**落到下面的 sherpa 路由**
    // （回退到均衡档）—— 未装、平台不支持、连崩被标记 failed，这三种都必须还有声音。
    if (opts?.tone === "best" && engine.available()) {
      const controller = new AbortController();
      engineAborts.set(streamId, controller);
      try {
        const result = await engine.speak({
          text,
          voiceId: engineVoice(),
          streamId,
          send: sendStream,
          signal: controller.signal,
        });
        // 取消后**既不发块也不发 done**（与 §3.5 同一条教训）。成功时 done 由
        // 桥接层发出，这里再发一次就是两个 done。
        if (cancelled.has(streamId)) return;
        if (!result.ok) {
          sendStream({ streamId, type: "error", error: result.error });
        }
      } catch (error) {
        // 引擎门面自身抛错（清单缺项、监督器构造失败）在这里兜住：不兜的话它会
        // 变成未处理拒绝，渲染层那边只看到一个永远不结束的流。
        if (!cancelled.has(streamId)) {
          sendStream({
            streamId,
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        engineAborts.delete(streamId);
      }
      return;
    }
    if (opts?.tone === "best") {
      log("[Tts] best tier unavailable, falling back to balanced");
    }

    let seq = 0;
    // 回退与"均衡"档走同一条路：把 tone 换成 balanced，别让 service 再解析回引擎
    const effective =
      opts?.tone === "best" ? { ...opts, tone: "balanced" as const } : opts;
    const result = await service.speak(text, effective, (chunk) => {
      if (cancelled.has(streamId)) return false;
      sendStream({ streamId, type: "chunk", seq: seq++, ...chunk });
      return true;
    });
    // 取消后**既不发块也不发 done**：调用方已经丢弃这个流，收到 done 会把它当成
    // 一次正常结束（设计 §3.5）。取消时 generateAsync 仍会正常 resolve（截断音频）。
    if (cancelled.has(streamId)) return;
    if (result.ok) sendStream({ streamId, type: "done" });
    else sendStream({ streamId, type: "error", error: result.error });
  };

  ipcMain.handle(
    "tts.speakStream",
    async (
      _event,
      text: string,
      opts?: TtsSpeakOptions,
    ): Promise<TtsSpeakStreamResult> => {
      const streamId = nextStreamId++;
      live.add(streamId);
      // 不 await：handler 必须立刻返回，块随后以事件推送。
      void runStream(streamId, text, opts).finally(() => {
        live.delete(streamId);
        cancelled.delete(streamId);
      });
      return { streamId };
    },
  );

  ipcMain.handle("tts.cancelStream", (_event, streamId: number) => {
    if (!live.has(streamId)) return;
    cancelled.add(streamId);
    // 引擎那一路还要**真的断开**：上游只有看到连接断开才会中止合成
    // （实测服务端日志出现 `aborted the synthesis`）。不 abort 的话，打断后引擎
    // 会把整句合成完，而它是串行的 —— 下一句要排队等着。
    engineAborts.get(streamId)?.abort();
  });

  /**
   * 试听：三档通用。返回**整句**音频（不流式）—— 只有一两秒，设置页那边
   * 一个短命 AudioContext 就够。
   *
   * 它**不查朗读门控**：试听是设置页的动作，不是朗读那条路。
   */
  ipcMain.handle(
    "tts.preview",
    async (_event, tone: TtsTone): Promise<TtsSpeakResult> => {
      if (!TONES.includes(tone)) return { ok: false, error: "unknown tone" };
      if (tone !== "best") return service.speak(PREVIEW_TEXT, { tone });

      if (!engine.available()) {
        // 不静默：用户点了按钮，就要知道为什么没声音
        return {
          ok: false,
          error: engine.installed()
            ? "engine unavailable"
            : "engine not installed",
        };
      }
      const chunks: Float32Array[] = [];
      let sampleRate = 24_000;
      const result = await engine.speak({
        text: PREVIEW_TEXT,
        voiceId: engineVoice(),
        streamId: -1, // 负数：与真实流不碰撞（cancelStream 的 live 守卫也会忽略它）
        send: (event) => {
          if (event.type === "chunk") {
            chunks.push(event.samples);
            sampleRate = event.sampleRate;
          }
        },
      });
      if (!result.ok) return { ok: false, error: result.error };
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const samples = new Float32Array(total);
      let at = 0;
      for (const chunk of chunks) {
        samples.set(chunk, at);
        at += chunk.length;
      }
      return { ok: true, samples, sampleRate };
    },
  );

  ipcMain.handle("tts.getEngineState", (): EngineInstallState => {
    // 磁盘上的事实优先于内存里的状态：用户可能手动删了目录
    const installed = engine.installed();
    const blocked = engine.blockedReason();
    return {
      ...engineState,
      installed,
      ...(installed
        ? { phase: "ready" as const, percent: 100, error: undefined }
        : {}),
      ...(blocked ? { blockedReason: blocked } : {}),
    };
  });

  ipcMain.handle("tts.installEngine", async () => {
    // 守卫与 sherpa 那边同形：已装 / 已在装都静默返回（渲染层会重读状态）
    if (engineInstalling || engine.installed()) return;
    const blocked = engine.blockedReason();
    if (blocked) {
      publishEngine({ ...engineIdle, blockedReason: blocked });
      return;
    }
    engineInstalling = true;
    try {
      publishEngine({ phase: "checking", percent: 0, installed: false });
      await engine.install({
        onProgress: (percent) =>
          publishEngine({
            phase: "downloading",
            percent: Math.round(percent * 100),
            installed: false,
          }),
        onPhase: (phase) =>
          publishEngine({ phase, percent: 100, installed: false }),
      });
      publishEngine({ phase: "ready", percent: 100, installed: true });
    } catch (error) {
      logError("[TtsEngine] install failed:", error);
      publishEngine({
        phase: "error",
        percent: 0,
        installed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      engineInstalling = false;
    }
  });

  ipcMain.handle("tts.removeEngine", () => {
    engine.remove();
    publishEngine({ ...engineIdle });
  });

  return {
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    },
  };
}
