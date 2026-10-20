/**
 * @module main/voice/emotion/ipc
 *
 * 情感识别的安装通道：state / install / remove，进度走 voice.event 的 emotion-install 事件
 * —— 渲染层已经在订阅那条通道，不必为「装到哪一步了」再开一条总线。
 *
 * 最近一次识别结果也只在这里记：它只在内存里，重启即空（spec §7：只存最近一次、只在本机）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ipcMain } from "electron";
import type {
  EmotionInstallState,
  VoiceEvent,
} from "../../../shared/ipc-types";
import type { EmotionSignal } from "../../../shared/voice-emotion";
import { downloadAndExtract } from "../../speech/installer";
import { log } from "../../utils/logger";
import {
  EMOTION_MODEL_ID,
  EMOTION_RUNTIME_VERSION,
  isEmotionInstalled,
  modelDir,
  readEmotionRuntimeSpec,
  removeEmotion,
  runtimeDir,
  writeEmotionManifest,
} from "./installer";

export interface EmotionIpcOptions {
  userDataPath: string;
  sendEvent: (event: VoiceEvent) => void;
  /** 删除模型前先释放 ORT 会话：Windows 上不释放会让 rm 失败，别处也会继续用旧模型推理。 */
  onBeforeRemove?: () => void;
}

export interface EmotionIpcHandle {
  /** 记下最近一次识别结果（由 voice.event 的 done 分支调用）。 */
  noteEmotion: (signal: EmotionSignal) => void;
}

/** 运行时占下载进度的前 30%，模型占后 70%。 */
const RUNTIME_SHARE = 30;

export function registerEmotionIpc({
  userDataPath,
  sendEvent,
  onBeforeRemove,
}: EmotionIpcOptions): EmotionIpcHandle {
  let installState: EmotionInstallState = {
    phase: "idle",
    percent: 0,
    installed: isEmotionInstalled(userDataPath),
  };

  const push = (next: Partial<EmotionInstallState>): void => {
    installState = { ...installState, ...next };
    sendEvent({ type: "emotion-install", state: installState });
  };

  ipcMain.handle("emotion.getState", async (): Promise<EmotionInstallState> => {
    const installed = isEmotionInstalled(userDataPath);
    if (installed !== installState.installed)
      push({ phase: installed ? "ready" : "idle", installed });
    return installState;
  });

  ipcMain.handle(
    "emotion.install",
    async (): Promise<{ ok: boolean; error?: string }> => {
      // 重入保护：两段下载都往同一目标写，连点两下能赶在事件到达之前发生。
      if (
        installState.phase === "downloading" ||
        installState.phase === "extracting"
      )
        return { ok: true };
      push({ phase: "downloading", percent: 0, error: undefined });
      try {
        const spec = readEmotionRuntimeSpec();
        // 键的形状是 `${process.platform}-${process.arch}`（win 平台就是 win32），
        // 与 resources/emotion-runtime.json、speech/ocr 的 runtimeKey() 必须一致。
        // 注意别跟 npm 包名的平台段（sherpa-onnx-win-x64 里的 "win"）搞混。
        const key = `${process.platform}-${process.arch}`;
        const runtimeUrl = spec.runtimeUrl[key];
        const runtimeSha = spec.runtimeSha256[key];
        if (!runtimeUrl || !runtimeSha)
          throw new Error(`no emotion runtime for ${key}`);

        if (
          !existsSync(
            join(runtimeDir(userDataPath), "node_modules", "onnxruntime-node"),
          )
        ) {
          await downloadAndExtract(
            {
              userDataPath,
              url: runtimeUrl,
              sha256: runtimeSha,
              onPhase: (phase) => push({ phase }),
              onProgress: (percent) =>
                push({
                  phase: "downloading",
                  percent: Math.floor((percent / 100) * RUNTIME_SHARE),
                }),
            },
            runtimeDir(userDataPath),
            0,
          );
        }
        await downloadAndExtract(
          {
            userDataPath,
            url: spec.modelUrl,
            sha256: spec.modelSha256,
            onPhase: (phase) => push({ phase }),
            onProgress: (percent) =>
              push({
                phase: "downloading",
                percent:
                  RUNTIME_SHARE +
                  Math.floor((percent / 100) * (100 - RUNTIME_SHARE)),
              }),
          },
          modelDir(userDataPath),
          0,
        );
        writeEmotionManifest(userDataPath, {
          version: EMOTION_RUNTIME_VERSION,
          model: EMOTION_MODEL_ID,
          installedAt: new Date().toISOString(),
        });
        push({ phase: "ready", percent: 100, installed: true });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("[Emotion] install failed:", error);
        push({
          phase: "error",
          installed: isEmotionInstalled(userDataPath),
          error: message,
        });
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle("emotion.remove", async (): Promise<{ ok: boolean }> => {
    onBeforeRemove?.();
    removeEmotion(userDataPath);
    push({ phase: "idle", percent: 0, installed: false, error: undefined });
    return { ok: true };
  });

  return {
    noteEmotion: (signal) => {
      installState = {
        ...installState,
        last: { ...signal, at: new Date().toISOString() },
      };
    },
  };
}
