// src/renderer/hooks/useVoiceEngine.ts
/**
 * @module renderer/hooks/useVoiceEngine
 *
 * 「引擎就绪」这件事只在这里回答：这一次点击能不能开始录音（`ensureReady`）、
 * 模型装到哪一步了（`install`）、没装时要不要先问一句（`confirmOpen` /
 * `confirmDownload` / `cancelDownload`）。
 *
 * 安装态的订阅从设置页搬过来两处共用 —— 以前只有设置页知道装没装，
 * 聊天页「点了才发现没装」只能报错。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceInstallState } from "../../shared/ipc-types";
import { useAppStore } from "../store";

/** 没装模型时的那次问询。两个回调都是 `void` —— 不把用户的思考时间挂在 promise 上。 */
export interface VoiceEngine {
  install: VoiceInstallState | null;
  ensureReady: () => Promise<boolean>;
  /** 那次问询开着没有。 */
  confirmOpen: boolean;
  /** 用户答「下载并开启」。 */
  confirmDownload: () => void;
  /** 用户答「取消」：什么都不写。 */
  cancelDownload: () => void;
}

export interface UseVoiceEngineOptions {
  /** 安装落到 `ready` 那一刻调一次。设置页不传 —— 它自己有状态行。 */
  onReady?: () => void;
  /**
   * 写配置失败时调一次。不报出去的话，那一次点击就是「什么都没发生」：
   * 弹窗关掉了、没下载、也没录音，用户无从判断。
   */
  onEnableFailed?: () => void;
}

export function useVoiceEngine(
  options: UseVoiceEngineOptions = {},
): VoiceEngine {
  const [install, setInstall] = useState<VoiceInstallState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const voice = window.electronAPI?.voice;
    if (!voice) return;
    const unsubscribe = voice.onEvent((event) => {
      if (event.type !== "install") return;
      setInstall(event.state);
      // 挂在事件上，不用「观察到 busy → installed 的跳变」：主进程那个
      // installState 是常驻的，重新挂载时首帧取到的就是 ready，跳变判定会误报。
      if (event.state.phase === "ready") optionsRef.current.onReady?.();
    });
    // 读不到就停在「未知」：麦克风照样能点，点了会再问一次主进程。
    void voice
      .getInstallState()
      .then(setInstall)
      .catch(() => {
        /* 未知态 */
      });
    return unsubscribe;
  }, []);

  /** 写 `enabled = true`。已经开着就什么都不做。返回是否成功。 */
  const enableVoice = useCallback(async () => {
    // 读 store 的最新值：渲染时的快照在 await 之后可能已经过期。
    const engine = useAppStore.getState().appConfig?.voiceEngine;
    if (engine?.enabled) return true;
    try {
      const saved = await window.electronAPI?.config.save({
        voiceEngine: {
          ...(engine ?? { enabled: false, shortcut: "AltRight" as const }),
          enabled: true,
        },
      });
      if (saved?.config) useAppStore.getState().setAppConfig(saved.config);
      return true;
    } catch (error) {
      console.error("[voice] enable failed:", error);
      optionsRef.current.onEnableFailed?.();
      return false;
    }
  }, []);

  const confirmDownload = useCallback(() => {
    setConfirmOpen(false);
    // 先写配置再起下载：装好那一刻 usePushToTalk 的开关才是开着的。
    void enableVoice().then((ok) => {
      if (ok) void window.electronAPI?.voice.install();
    });
  }, [enableVoice]);

  const cancelDownload = useCallback(() => setConfirmOpen(false), []);

  const ensureReady = useCallback(async () => {
    const voice = window.electronAPI?.voice;
    if (!voice) return false;

    let state: VoiceInstallState;
    try {
      state = await voice.getInstallState();
    } catch (error) {
      console.error("[voice] getInstallState rejected:", error);
      return false;
    }

    if (!state.installed) {
      // 已经在装（下载 / 解压中）：不重复问，也不再下一次。这条路径由按住说话的
      // 快捷键走得到 —— 下载中麦克风按钮本来就是禁用的。
      if (state.phase === "downloading" || state.phase === "extracting")
        return false;
      // 不把用户的思考时间挂在 promise 上：这一次点击已经有结论（不录音），
      // 要不要下 140MB 是他回答弹窗的事（见 confirmDownload）。
      // 再点一次只是把弹窗摆回眼前，不会重复下载。
      setConfirmOpen(true);
      return false;
    }

    // 已装就直接录（不够用时写一次配置）；不下载就不问，不打扰。
    return enableVoice();
  }, [enableVoice]);

  return {
    install,
    ensureReady,
    confirmOpen,
    confirmDownload,
    cancelDownload,
  };
}
