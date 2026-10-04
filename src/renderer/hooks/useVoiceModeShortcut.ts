/**
 * @module renderer/hooks/useVoiceModeShortcut
 *
 * 语音模式的开关快捷键（默认 ⌘/Ctrl + Shift + Space）。
 *
 * 用**应用内**键盘事件而不是 globalShortcut：与按住说话同一条理由 ——
 * 不需要辅助功能权限，也不跟系统抢快捷键。代价是只在应用聚焦时生效，
 * 而这正是要的（应用不在前台时看不见语音浮层）。
 *
 * 不做成可配置项：设置区只暴露一个静音时长（设计 §3），多一个开关就多一套
 * 白名单、校验与设置 UI。真有人抱怨键位再补。
 */
import { useEffect, useRef } from "react";

export function useVoiceModeShortcut(
  onToggle: () => void,
  enabled = true,
): void {
  // 回调放 ref：宿主多传行内函数，进 deps 会让 effect 每次渲染都重订阅。
  const handlerRef = useRef(onToggle);
  handlerRef.current = onToggle;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // macOS 用 Cmd，其它平台用 Ctrl：两个都收，省一套平台判断。
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.code !== "Space") return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
