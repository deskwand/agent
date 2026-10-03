/**
 * @module renderer/hooks/usePushToTalk
 *
 * 按住说话（对齐微信电脑端的「长按右 Alt」）。
 *
 * 用**应用内**键盘事件而不是 globalShortcut：不需要辅助功能权限，也不跟系统
 * 抢快捷键。代价是只在应用聚焦时生效 —— 这正是我们要的（应用不在前台时，
 * 用户看不见实时文字，录音体验是坏的）。
 *
 * Fn 键做不到（Electron 拿不到，且外接键盘可能根本不发 Fn 键码），所以默认
 * 右 Option。见设计文档 §3.4。
 */
import { useEffect, useRef } from "react";

/** 白名单外的值一律不监听。 */
export type PushToTalkShortcut =
  | "AltRight"
  | "AltSpace"
  | "MetaShiftSpace"
  | "disabled";

interface KeyPattern {
  code?: string;
  alt?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const PATTERNS: Record<Exclude<PushToTalkShortcut, "disabled">, KeyPattern> = {
  AltRight: { code: "AltRight" },
  AltSpace: { code: "Space", alt: true },
  MetaShiftSpace: { code: "Space", meta: true, shift: true },
};

function matches(event: KeyboardEvent, pattern: KeyPattern): boolean {
  if (pattern.code && event.code !== pattern.code) return false;
  // 未指定的修饰键 := **不关心**。
  //
  // 不能当成「必须没按」：按住右 Option 时，它自己的 keydown 里 `altKey` 已经是
  // true（修饰键在被按下的那一刻就已经生效），而 keyup 里又是 false。
  // 当成「必须没按」的话 AltRight 这个默认键位两边都匹配不上 —— 按下去没反应。
  if (pattern.alt !== undefined && pattern.alt !== event.altKey) return false;
  if (pattern.meta !== undefined && pattern.meta !== event.metaKey)
    return false;
  if (pattern.shift !== undefined && pattern.shift !== event.shiftKey)
    return false;
  return true;
}

export function usePushToTalk(
  shortcut: string,
  handlers: { onStart: () => void; onStop: () => void },
  enabled = true,
): void {
  // 回调放 ref：宿主传的是行内对象，每次渲染都是新引用。进 deps 会让 effect 每次
  // 渲染都重订阅 —— 而重订阅会把 holding 清回 false，于是 keyup 永远匹配不上，
  // 表现就是“按下去就停不下来”。
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || shortcut === "disabled" || !(shortcut in PATTERNS)) return;
    const pattern = PATTERNS[shortcut as keyof typeof PATTERNS];
    let holding = false;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !matches(event, pattern)) return;
      // 单按修饰键在输入框里不产生字符，但组合键会 —— 统一拦掉
      event.preventDefault();
      holding = true;
      handlersRef.current.onStart();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!holding || !matches(event, pattern)) return;
      event.preventDefault();
      holding = false;
      handlersRef.current.onStop();
    };
    // 失焦时松开：否则切走窗口后按键状态会卡住
    const onBlur = () => {
      if (!holding) return;
      holding = false;
      handlersRef.current.onStop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [shortcut, enabled]);
}
