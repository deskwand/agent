/**
 * @module renderer/components/voice-mode/VoiceModeHost
 *
 * 全应用唯一挂载语音运行时的地方。它决定画全屏还是右下角小球，
 * 生命周期也跟着它走：卸载 = 结束语音。
 *
 * **key 必须是 sessionId**：换语音会话就是换运行时，靠 React 的 key 让旧宿主
 * 卸载（停麦、取消 ASR）、新宿主挂载。这就是「顶掉」。
 *
 * **最小化只在跳变上改**：进入语音会话展开、离开语音会话收起。写成「active
 * 为真就展开」的话，用户显式点了最小化会立刻被撤销。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useVoiceMode } from "../../hooks/useVoiceMode";
import { VoiceModeOverlay } from "../VoiceModeOverlay";
import { CAPTION_KEY } from "./orb-state";
import { VOICE_MESSAGE_KEYS } from "../../hooks/useVoiceInput";
import { voiceCaptionLine } from "../../utils/voice/voice-caption";
import { getCapabilityGate } from "../../capabilities/capability-gate";
import { resolveTtsSource } from "../../../shared/voice-mode";
import type { TtsInstallStates } from "../../../shared/ipc-types";

/** tts 三档的安装态。事件只带一个模型，所以整份重读一次，省得自己拼三个键。 */
function useTtsInstalls(): TtsInstallStates | null {
  const [installs, setInstalls] = useState<TtsInstallStates | null>(null);
  useEffect(() => {
    const tts = window.electronAPI?.tts;
    if (!tts) return;
    const unsubscribe = tts.onEvent((event) => {
      if (event.type !== "install") return;
      void tts
        .getInstallState()
        .then(setInstalls)
        .catch(() => {
          /* 未知态 */
        });
    });
    void tts
      .getInstallState()
      .then(setInstalls)
      .catch(() => {
        /* 未知态 */
      });
    return unsubscribe;
  }, []);
  return installs;
}

export interface VoiceModeHostProps {
  sessionId: string;
  /** 把一轮问题发出去。返回值表示宿主收没收下这一轮。 */
  onSendQuestion(text: string, turnId: string): boolean;
}

export function VoiceModeHost({
  sessionId,
  onSendQuestion,
}: VoiceModeHostProps): JSX.Element {
  const { t } = useTranslation();
  const activeView = useAppStore((s) => s.activeView);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const minimized = useAppStore((s) => s.voiceModeMinimized);
  const setMinimized = useAppStore((s) => s.setVoiceModeMinimized);
  const closeVoiceMode = useAppStore((s) => s.closeVoiceMode);
  // 静音不再挂在这里的局部 state：header 卡片要读它、要写它（两处必须一致）。
  // 音频帧级的 `view.level` 仍只留在宿主：它是高频值，不进 store。
  const muted = useAppStore((s) => s.voiceModeMuted);
  const setMiniCaption = useAppStore((s) => s.setVoiceMiniCaption);
  const setMiniState = useAppStore((s) => s.setVoiceMiniState);
  const isCompacting = useAppStore(
    (s) => s.sessionStates[sessionId]?.compaction.status === "running",
  );

  const active = activeView === "chat" && activeSessionId === sessionId;
  const view = useVoiceMode({
    sessionId,
    isCompacting,
    muted,
    sendQuestion: onSendQuestion,
  });

  const ttsInstalls = useTtsInstalls();
  const voiceMode = useAppStore((s) => s.appConfig?.voiceMode);
  // 云端来源不需要下载；本机来源且三档都没装时，回答只会有字幕没有声音。
  const ttsMissing =
    resolveTtsSource(voiceMode) === "local" &&
    ttsInstalls !== null &&
    !ttsInstalls.zh.installed &&
    !ttsInstalls.matcha.installed &&
    !ttsInstalls.en.installed;

  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current === active) return;
    wasActive.current = active;
    setMinimized(!active);
  }, [active, setMinimized]);

  // header 卡片要显示的那一行（错误 → 消息、否则实时字幕、空则状态文案）。
  // 浮层那份是既有的第二份拷贝（`VoiceModeOverlay.tsx` 自己算状态行），本次没动它。
  // 依赖是**字符串本身** —— `view.level` 每 100ms 变一次，但字幕不变就不会写 store。
  const caption = view.error
    ? t(VOICE_MESSAGE_KEYS[view.error])
    : voiceCaptionLine(view) || t(CAPTION_KEY[view.state]);
  useEffect(() => {
    setMiniCaption(caption);
    setMiniState(view.state);
  }, [setMiniCaption, setMiniState, caption, view.state]);
  // 宿主卸载（会话关闭）时两个一起清掉：图标据此消失
  useEffect(
    () => () => {
      setMiniCaption(null);
      setMiniState(null);
    },
    [setMiniCaption, setMiniState],
  );

  // 最小化后什么都不画：那颗球与它的卡片在 header 里（`VoiceMiniButton`），
  // 这里只负责运行时与全屏浮层。
  if (!active || minimized) return <></>;

  return (
    <VoiceModeOverlay
      view={view}
      onClose={closeVoiceMode}
      onMinimize={() => setMinimized(true)}
      ttsMissing={ttsMissing}
      onInstallTts={() => void getCapabilityGate().startInstall("voice")}
    />
  );
}
