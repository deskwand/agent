import { useEffect, useRef } from "react";

/**
 * 搜索弹窗的键位：⌘/Ctrl + K。
 *
 * 与 `useIdeaCaptureShortcut` 同法：只在应用内监听 `keydown`，不注册
 * `globalShortcut` —— 不抢系统快捷键、不需要辅助功能权限；应用不在前台时
 * 本来就看不见弹窗，全局热键没有意义。
 *
 * 不用 `⌘⇧K`（记一笔已占）：两个快捷键若撞车，幂等的那一个会被另一个吞掉。
 * 所以这里**显式**排除 shift / alt，而不是只认 `metaKey || ctrlKey`。
 */
export const SESSION_SEARCH_SHORTCUT = "KeyK";

export function useSessionSearchShortcut(
  onOpen: () => void,
  enabled = true,
): void {
  // 回调放 ref：宿主常传行内函数，进 deps 会让 effect 每次渲染都重订阅。
  const handlerRef = useRef(onOpen);
  handlerRef.current = onOpen;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented) return;
      // macOS 用 Cmd，其它平台用 Ctrl：两个都收，省一套平台判断。
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      if (event.code !== SESSION_SEARCH_SHORTCUT) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
