/**
 * @module main/voice/ipc
 *
 * 语音的八个 invoke 通道。会话表在主进程 —— 窗口重载不该把录音状态一起丢掉。
 *
 * 推送走**独立通道** `voice.event`，不走 `server-event` 总线：那条总线会拿
 * `payload.sessionId` 去问 `remoteRuntimeBootstrap.isAgentSession(...)` 做远程
 * 会话路由，而语音的 sessionId 不是 agent session。沙箱进度用的是 server-event，
 * 这里刻意不一致，理由是语义纯度。
 */
import { ipcMain, systemPreferences } from "electron";
import { randomUUID } from "node:crypto";
import type {
  VoiceEvent,
  VoiceInstallState,
  VoicePolishedResult,
  VoiceStartResult,
} from "../../shared/ipc-types";
import { configStore } from "../config/config-store";
import {
  buildUtilityAppConfig,
  resolveUtilityModelConfig,
} from "../memory/memory-llm-client";
import { logWarn } from "../utils/logger";
import { LocalTranscriptionEngine, loadSherpaAddon } from "./local-engine";
import { VoiceSession } from "./session";
import {
  MODEL_ID,
  RUNTIME_VERSION,
  installModel,
  installRuntime,
  readManifest,
  removeVoice,
  voiceRoot,
} from "./installer";
import { readRuntimeSpec, runtimeKey } from "./runtime-spec";
import { polishTranscriptWithAgentSdk } from "./transcript-polish";

export interface VoiceIpcOptions {
  sendEvent: (event: VoiceEvent) => void;
  userDataPath: string;
}

export interface VoiceIpcHandle {
  /** 主窗口销毁时调用：中断全部会话，避免悬挂。 */
  dispose: () => void;
}

/**
 * macOS 的麦克风授权。放在这里而不是等渲染层的 `getUserMedia` 失败：
 * 主进程能区分「用户拒绝」与「没有设备」，渲染层只能拿到一个 NotAllowedError。
 *
 * Windows / Linux 直接放行 —— 系统禁用麦克风时 `getUserMedia` 自己会失败，
 * 走同一条错误路径。`askForMediaAccess` 是 macOS 专有 API。
 */
async function ensureMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  try {
    if (systemPreferences.getMediaAccessStatus("microphone") === "granted")
      return true;
    return await systemPreferences.askForMediaAccess("microphone");
  } catch (error) {
    logWarn("[Voice] microphone permission check failed:", error);
    return false;
  }
}

export function registerVoiceIpc({
  sendEvent,
  userDataPath,
}: VoiceIpcOptions): VoiceIpcHandle {
  /**
   * 进度按**体积**分成两段，不是五五分。
   *
   * 运行时每个平台 8.7~10.8MB，模型 128MB —— 五五分会让进度条在 1 秒内冲到 50%，
   * 然后卡着慢慢爬。首次启用是最敏感的一屏，误导性进度比没有进度更糟。
   */
  const RUNTIME_SHARE = 7;
  const sessions = new Map<string, VoiceSession>();
  let installState: VoiceInstallState = {
    phase: "idle",
    percent: 0,
    installed: false,
  };
  /**
   * 引擎（连同它内部的 recognizer）只构造一次，之后所有会话共用。
   *
   * 真正的冷启动代价（读 162MB 模型，实测约 2.2s）不在构造函数里，而在**第一次**
   * `createStream()` —— 那一步才把模型读进内存。所以必须让这个实例活到进程结束；
   * 重建它就会把每条录音的延迟打回两秒多。
   */
  let engine: LocalTranscriptionEngine | null = null;

  const pushInstallState = (next: Partial<VoiceInstallState>): void => {
    installState = { ...installState, ...next };
    sendEvent({ type: "install", state: installState });
  };

  const isInstalled = (): boolean => {
    const manifest = readManifest(userDataPath);
    return (
      manifest?.runtimeVersion === RUNTIME_VERSION &&
      manifest.model === MODEL_ID
    );
  };

  const drop = (sessionId: string): VoiceSession | undefined => {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    return session;
  };

  ipcMain.handle("voice.start", async (): Promise<VoiceStartResult> => {
    const engineConfig = configStore.getAll().voiceEngine;
    if (!engineConfig?.enabled)
      return { ok: false, code: "VOICE_NOT_CONFIGURED" };
    if (!isInstalled()) return { ok: false, code: "VOICE_NOT_INSTALLED" };
    if (!(await ensureMicrophoneAccess()))
      return { ok: false, code: "VOICE_MIC_DENIED" };

    const sessionId = randomUUID();
    try {
      if (!engine) {
        engine = new LocalTranscriptionEngine({
          addon: loadSherpaAddon(voiceRoot(userDataPath), RUNTIME_VERSION),
          modelDir: `${voiceRoot(userDataPath)}/models/${MODEL_ID}`,
        });
      }
      // 构造 VoiceSession 会立刻建识别流（addon.createOnlineRecognizer），模型配置不对就在这里抛。
      // 它必须在 try 里：否则 handler 直接 reject，渲染侧那个 await 没人接 ——
      // 采集不会停（系统录音灯常亮），且状态卡在 requesting，而 requesting 下按钮是禁用的。
      sessions.set(
        sessionId,
        new VoiceSession({
          engine,
          events: {
            onPartial: (text) =>
              sendEvent({ type: "partial", sessionId, text }),
            onDone: ({ text, discarded }) => {
              drop(sessionId);
              sendEvent({ type: "done", sessionId, text, discarded });
            },
            onError: (code, message) => {
              drop(sessionId);
              sendEvent({ type: "error", sessionId, code, message });
            },
          },
        }),
      );
    } catch (error) {
      // VoiceStartResult 没有 message 字段（错误文案由渲染层按 code 查表），
      // 细节只进日志。
      logWarn("[Voice] engine init failed:", error);
      return { ok: false, code: "VOICE_ENGINE_FAILED" };
    }

    return { ok: true, sessionId };
  });

  ipcMain.handle(
    "voice.pushAudio",
    (_event, sessionId: string, pcm: ArrayBuffer) => {
      if (typeof sessionId !== "string") return;
      sessions.get(sessionId)?.push(new Int16Array(pcm));
    },
  );

  ipcMain.handle("voice.stop", async (_event, sessionId: string) => {
    await drop(sessionId)?.stop();
  });

  ipcMain.handle("voice.cancel", (_event, sessionId: string) => {
    drop(sessionId)?.abort();
  });

  ipcMain.handle(
    "voice.polish",
    async (
      _event,
      text: string,
      sessionId: string | null,
    ): Promise<VoicePolishedResult> => {
      if (typeof text !== "string") return { ok: false, reason: "empty" };
      const appConfig = configStore.getAll();
      // 轻量任务模型：用户已配好的那个，不需要新配置项。
      const utilityConfig = buildUtilityAppConfig(
        appConfig,
        resolveUtilityModelConfig(appConfig, appConfig.model),
      );
      const result = await polishTranscriptWithAgentSdk(
        text,
        utilityConfig,
        sessionId,
      );
      return result.ok
        ? { ok: true, text: result.text }
        : { ok: false, reason: result.reason };
    },
  );

  ipcMain.handle("voice.getInstallState", () => ({
    ...installState,
    installed: isInstalled(),
  }));

  ipcMain.handle("voice.install", async () => {
    pushInstallState({ phase: "downloading", percent: 0, error: undefined });
    try {
      const spec = readRuntimeSpec();
      if (readManifest(userDataPath)?.runtimeVersion !== RUNTIME_VERSION) {
        await installRuntime({
          userDataPath,
          platform: process.platform === "win32" ? "win" : process.platform,
          arch: process.arch,
          runtimeSha256: spec.runtimeSha256[runtimeKey()] ?? "",
          nodeSha256: spec.nodeSha256,
          onProgress: (percent) =>
            pushInstallState({
              phase: "downloading",
              percent: Math.floor((percent / 100) * RUNTIME_SHARE),
            }),
        });
      }
      if (readManifest(userDataPath)?.model !== MODEL_ID) {
        await installModel({
          userDataPath,
          url: spec.modelUrl,
          sha256: spec.modelSha256,
          onProgress: (percent) =>
            pushInstallState({
              phase: "extracting",
              percent:
                RUNTIME_SHARE +
                Math.floor((percent / 100) * (100 - RUNTIME_SHARE)),
            }),
        });
      }
      pushInstallState({ phase: "ready", percent: 100, installed: true });
      engine = null; // 下次用时按刚装的运行时重建
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushInstallState({ phase: "error", error: message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("voice.removeInstall", async () => {
    engine = null;
    try {
      await removeVoice(userDataPath);
    } catch (error) {
      // Windows 上删不掉正被原生 addon 映射着的模型文件（内存映射占用）。
      // 不接住的话渲染侧的 await 直接 reject，设置页停在「已安装」，而目录可能
      // 只删了一半 —— 用户既用不了也删不掉。所以返回失败形态，并把**真实的**
      // 已装状态报回去（而不是假定删干净了）。
      const message = error instanceof Error ? error.message : String(error);
      logWarn("[Voice] removeInstall failed:", error);
      pushInstallState({
        phase: "error",
        error: message,
        installed: isInstalled(),
      });
      return { ok: false, error: message };
    }
    pushInstallState({ phase: "idle", percent: 0, installed: false });
    return { ok: true };
  });

  return {
    dispose: () => {
      for (const session of sessions.values()) session.abort();
      sessions.clear();
    },
  };
}
