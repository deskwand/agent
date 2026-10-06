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
import { useAppStore } from "../../store";
import { useEffectiveTheme } from "../../store/selectors";
import { useVoiceMode } from "../../hooks/useVoiceMode";
import { VoiceModeOverlay } from "../VoiceModeOverlay";
import { VoiceMiniBar } from "./VoiceMiniBar";
import { STARS_BRUSH_DARK, STARS_BRUSH_LIGHT } from "./star-orb";

export interface VoiceModeHostProps {
  sessionId: string;
  /** 把一轮问题发出去。返回值表示宿主收没收下这一轮。 */
  onSendQuestion(text: string, turnId: string): boolean;
}

export function VoiceModeHost({
  sessionId,
  onSendQuestion,
}: VoiceModeHostProps): JSX.Element {
  const activeView = useAppStore((s) => s.activeView);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const minimized = useAppStore((s) => s.voiceModeMinimized);
  // 小球要按主题换画笔：浅底用深色粒子。全屏那颗不受主题影响（永远深底）。
  const isDark = useEffectiveTheme() === "dark";
  const setMinimized = useAppStore((s) => s.setVoiceModeMinimized);
  const closeVoiceMode = useAppStore((s) => s.closeVoiceMode);
  // 静音是本地的运行时 UI 状态：宿主跨最小化 / 展开不卸载，所以活得下来；
  // 换语音会话时宿主重建，它自动归零 —— 这正是想要的语义。
  const [muted, setMuted] = useState(false);
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

  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current === active) return;
    wasActive.current = active;
    setMinimized(!active);
  }, [active, setMinimized]);

  if (active && !minimized)
    return (
      <VoiceModeOverlay
        view={view}
        onClose={closeVoiceMode}
        onMinimize={() => setMinimized(true)}
      />
    );

  return (
    <VoiceMiniBar
      view={view}
      muted={muted}
      brush={isDark ? STARS_BRUSH_DARK : STARS_BRUSH_LIGHT}
      onExpand={() => setMinimized(false)}
      onToggleMute={() => setMuted((prev) => !prev)}
      onEnd={closeVoiceMode}
    />
  );
}
