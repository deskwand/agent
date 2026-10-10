import { useEffect, useRef } from "react";

/**
 * 记一笔的显示键位。**不用 `⌘⇧I`**：本仓库只在 macOS 建应用菜单
 * （`buildMacMenu()` 非 darwin 直接 return），Windows 吃 Electron 默认菜单，
 * 而默认菜单的 View → Toggle Developer Tools 正是 `Ctrl+Shift+I`。
 */
export const IDEA_CAPTURE_SHORTCUT = "KeyK";

/**
 * 应用内快捷键（默认 ⌘/Ctrl + Shift + K），与 `useVoiceModeShortcut` 同法：
 * 不注册 globalShortcut —— 不抢系统快捷键、不需要辅助功能权限，代价是只在应用
 * 聚焦时生效，而这正是我们要的（不在前台时看不见浮层）。
 */
export function useIdeaCaptureShortcut(
  onOpen: () => void,
  enabled = true,
): void {
  // 回调放 ref：宿主多传行内函数，进 deps 会让 effect 每次渲染都重订阅。
  const handlerRef = useRef(onOpen);
  handlerRef.current = onOpen;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // macOS 用 Cmd，其它平台用 Ctrl：两个都收，省一套平台判断。
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.code !== IDEA_CAPTURE_SHORTCUT) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
