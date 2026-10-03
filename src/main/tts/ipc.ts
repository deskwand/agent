/**
 * @module main/tts/ipc
 *
 * 朗读的通道：安装 + 按句合成。
 *
 * 与语音输入**分开注册**（`voice.*` / `tts.*`）：开关、安装状态、引擎生命周期各自
 * 独立，只有磁盘上的目录与运行时是共享的。合成一个模块会让「关掉语音」与
 * 「关掉朗读」纠缠在一起。
 */
import type { IpcMain } from "electron";
import type {
  TtsEvent,
  TtsInstallState,
  TtsSpeakResult,
} from "../../shared/ipc-types";
import type { TtsService } from "./service";
import { getTtsService } from "./service";
import {
  installRuntime,
  installTtsModel,
  readManifest,
  removeTtsModel,
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
  let state: TtsInstallState = { phase: "idle", percent: 0, installed: false };
  let installing = false;

  const publish = (next: TtsInstallState) => {
    state = next;
    sendEvent({ type: "install", state });
  };

  ipcMain.handle("tts.getInstallState", () => ({
    ...state,
    installed: service.isInstalled(),
  }));

  ipcMain.handle("tts.install", async () => {
    if (installing || service.isInstalled()) return;
    installing = true;
    const onProgress = (percent: number) =>
      publish({ phase: "downloading", percent, installed: false });
    const onPhase = (phase: "downloading" | "extracting") =>
      publish({ phase, percent: 100, installed: false });
    try {
      const spec = installer.readSpec();
      const [platform, arch] = runtimeKey().split("-");
      // 运行时可能已经由语音输入装好了；installRuntime 是幂等的。
      if (!readManifest(userDataPath)?.runtimeVersion) {
        publish({ phase: "downloading", percent: 0, installed: false });
        await installer.installRuntime({
          userDataPath,
          platform,
          arch,
          runtimeSha256: spec.runtimeSha256[runtimeKey()],
          nodeSha256: spec.nodeSha256,
          onProgress,
          onPhase,
        });
      }
      publish({ phase: "downloading", percent: 0, installed: false });
      await installer.installTtsModel({
        userDataPath,
        url: spec.ttsModelUrl,
        sha256: spec.ttsModelSha256,
        onProgress,
        onPhase,
      });
      // 装完立刻加载模型并合成一句：平台不兼容 / 文件不全要在**安装时**暴露，
      // 不能等用户点朗读才发现（本地引擎是一期唯一通路，没有云端兜底）。
      // 内存代价是承认的 —— 用户刚装了模型，本来就要用它。
      const selfCheck = await service.speak("语音引擎自检。"); // i18n-allow-cjk 自检用语，产物丢弃，不给用户看
      if (!selfCheck.ok) {
        // 自检失败就把刚装的东西撤掉。否则清单里写着「已装」，重试会被
        // isInstalled() 挡在门外 —— 用户既用不了朗读，也没有任何入口修它。
        installer.removeTtsModel(userDataPath);
        throw new Error(selfCheck.error);
      }
      publish({ phase: "ready", percent: 100, installed: true });
    } catch (error) {
      logError("[Tts] install failed:", error);
      publish({
        phase: "error",
        percent: 0,
        installed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      installing = false;
    }
  });

  ipcMain.handle("tts.removeInstall", () => {
    removeTtsModel(userDataPath);
    // 引擎常驻内存、没有卸载接口 —— 只能重启才归还。不要假装已释放。
    publish({ phase: "idle", percent: 0, installed: false });
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
