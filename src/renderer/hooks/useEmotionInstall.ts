/**
 * @module renderer/hooks/useEmotionInstall
 *
 * 情感识别的安装态与最近一次结果。与 `useVoiceEngine` 分开：那是「这次点击能不能
 * 录音」，这是「情感模型装到哪一步了」，两件事的失败互不影响。
 *
 * 进度与结果都从 `voice.onEvent` 拿 —— 主进程复用同一条通道（emotion-install 事件）。
 */
import { useCallback, useEffect, useState } from "react";
import type { EmotionInstallState } from "../../shared/ipc-types";

export interface EmotionInstall {
  state: EmotionInstallState | null;
  installed: boolean;
  busy: boolean;
  error: string | null;
  install: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useEmotionInstall(): EmotionInstall {
  const [state, setState] = useState<EmotionInstallState | null>(null);

  useEffect(() => {
    const voice = window.electronAPI?.voice;
    const emotion = window.electronAPI?.emotion;
    if (!voice || !emotion) return;
    const unsubscribe = voice.onEvent((event) => {
      if (event.type !== "emotion-install") return;
      setState(event.state);
    });
    void emotion
      .getState()
      .then(setState)
      .catch(() => {
        /* 未知态：界面按「没装」显示 */
      });
    return unsubscribe;
  }, []);

  const install = useCallback(async () => {
    const result = await window.electronAPI?.emotion.install();
    if (result && !result.ok)
      setState((prev) =>
        prev ? { ...prev, phase: "error", error: result.error } : prev,
      );
  }, []);

  const remove = useCallback(async () => {
    await window.electronAPI?.emotion.remove();
  }, []);

  const busy = state?.phase === "downloading" || state?.phase === "extracting";
  return {
    state,
    installed: state?.installed === true,
    busy,
    error: state?.error ?? null,
    install,
    remove,
  };
}
