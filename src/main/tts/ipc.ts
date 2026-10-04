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
 */
import type { IpcMain } from "electron";
import type {
  TtsEvent,
  TtsInstallState,
  TtsInstallStates,
  TtsModelKey,
  TtsSpeakResult,
} from "../../shared/ipc-types";
import type { TtsService } from "./service";
import { getTtsService } from "./service";
import {
  TTS_ENGLISH_MODEL_ID,
  TTS_MODEL_ID,
  installRuntime,
  installTtsModel,
  readManifest,
  removeTtsModel,
  type TtsModelId,
} from "../speech/installer";
import { readRuntimeSpec, runtimeKey } from "../speech/runtime-spec";
import { configStore } from "../config/config-store";
import { logError } from "../utils/logger";

export interface TtsIpcDeps {
  userDataPath: string;
  sendEvent: (event: TtsEvent) => void;
  /** 注入以便测试。默认 getTtsService(...)。 */
  service?: TtsService;
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
] as const;

const MODELS: TtsModelKey[] = ["zh", "en"];

const MODEL_ID_BY_KEY: Record<TtsModelKey, TtsModelId> = {
  zh: TTS_MODEL_ID,
  en: TTS_ENGLISH_MODEL_ID,
};

/**
 * 自检句与引擎都**显式指定**，不走路由：自检要验证"这个模型能不能出声"，
 * 判定规则一变它就会测到别人身上去。
 */
const SELF_CHECK: Record<TtsModelKey, { text: string; engine: TtsModelKey }> = {
  zh: { text: "语音引擎自检。", engine: "zh" }, // i18n-allow-cjk 自检用语，产物丢弃，不给用户看
  en: { text: "This is a test.", engine: "en" },
};

export function registerTtsIpc({
  ipcMain,
  deps,
}: {
  ipcMain: IpcMain;
  deps: TtsIpcDeps;
}): TtsIpcHandle {
  const { userDataPath, sendEvent } = deps;
  const service = deps.service ?? getTtsService({ userDataPath });
  const installer = {
    readSpec: readRuntimeSpec,
    installRuntime,
    installTtsModel,
    removeTtsModel,
    ...deps.installDeps,
  };

  const idle: TtsInstallState = { phase: "idle", percent: 0, installed: false };
  const states: TtsInstallStates = { zh: { ...idle }, en: { ...idle } };
  const installing: Record<TtsModelKey, boolean> = { zh: false, en: false };

  const publish = (model: TtsModelKey, next: TtsInstallState) => {
    states[model] = next;
    sendEvent({ type: "install", model, state: next });
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
      const target = {
        id: MODEL_ID_BY_KEY[model],
        url: model === "zh" ? spec.ttsModelUrl : spec.ttsEnglishModelUrl,
        sha256:
          model === "zh" ? spec.ttsModelSha256 : spec.ttsEnglishModelSha256,
      };
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
    async (_event, text: string): Promise<TtsSpeakResult> => {
      // 与 voice.start 同一条：开关关掉就不干活。设置卡只管下载是不够的 ——
      // 关掉之后必须真的不加载引擎、不出声（设计 §6.1 验收第 4 条）。
      if (!configStore.getAll().readAloud?.enabled) {
        return { ok: false, error: "read aloud disabled" };
      }
      return service.speak(text);
    },
  );

  return {
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    },
  };
}
