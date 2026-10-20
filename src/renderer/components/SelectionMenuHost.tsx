/**
 * @module renderer/components/SelectionMenuHost
 *
 * 划词菜单的宿主：全局监听鼠标，把选区解析成快照后渲染一排动作。常驻 App 根。
 *
 * 三条要点：
 * 1. **只在 mouseup 判定**，不在 selectionchange 里判定 —— 否则拖选途中会一路闪。
 * 2. **必须存快照**：点菜单那一刻活选区已经塌陷，所以 mouseup 时就 clone 一份 Range。
 * 3. **按在选区所在内容面里不关**：双击选词的第二次按下就落在同一个段落里，
 *    一律关掉的话双击看到的是一次闪烁。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import {
  resolveSelectionContext,
  type SelectionContext,
  type SelectionRuntime,
} from "../utils/selection-menu";
import { isSpeaking, stopSelectionSpeech } from "../utils/tts/selection-speech";
import { SELECTION_ACTIONS } from "./selection-menu-actions";
import {
  MENU_ITEM_BAR_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_PANEL_PADDED_CLASS,
} from "./menu-styles";

/** 菜单与选区、与视口边缘的间距（px）。 */
const GAP = 8;

export function SelectionMenuHost(): JSX.Element | null {
  const { t } = useTranslation();
  const [ctx, setCtx] = useState<SelectionContext | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 按下那一刻的选区文本：松开时没变就说明这一对不是在划选（拖面板、拖文件）。 */
  const pressTextRef = useRef("");
  /** 事件监听里要读最新值，但不想把 ctx 放进依赖 —— 与 IdeaCaptureOverlay 的 textRef 同法。 */
  const ctxRef = useRef<SelectionContext | null>(null);
  ctxRef.current = ctx;
  // 这两个订阅是给标签用的：动作从 runtime 读实时值，而 runtime 变了 React 得重渲染
  // （朗读播完那一刻菜单若还开着，标签要回到「朗读这段」）。
  const speechStatus = useAppStore((s) => s.selectionSpeech.status);
  const voiceModeOpen = useAppStore((s) => s.voiceModeOpen);
  const runtime: SelectionRuntime = {
    speaking: isSpeaking(speechStatus),
    voiceModeOpen,
  };

  const close = useCallback(() => {
    setCtx(null);
    setPos(null);
  }, []);

  // 出现：mouseup；关闭：按在选区所在内容面之外
  useEffect(() => {
    const isInsideSelectionFace = (target: Element | null) => {
      const current = ctxRef.current;
      if (!current || !target) return false;
      const root = current.range.commonAncestorContainer;
      const face = root.nodeType === 1 ? (root as Element) : root.parentElement;
      // 按在同一个内容面里不关：双击选词的第二次按下就落在同一个段落里。
      // 「点别处把选区点没了」的那些用例由 selectionchange 到塌陷那条兜住。
      return Boolean(face?.contains(target));
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // ⚠️ 不要 stopPropagation：AttachMenu 与 ChatInput 也在 document 上挂着
      // mousedown 做点外关闭，拦一刀会让它们静默失效。
      if (target?.closest?.('[data-selection-menu="1"]')) return;
      pressTextRef.current = window.getSelection()?.toString() ?? "";
      if (!isInsideSelectionFace(target)) close();
    };
    const onMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString() ?? "";
      // 这一对按下/松开没改选区：不是在划选，不新开。
      if (text === pressTextRef.current) return;
      const next = resolveSelectionContext(selection);
      if (!next) return;
      setCtx(next);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [close]);

  // 消失：滚动 / 改窗口 / 失焦
  useEffect(() => {
    if (!ctx) return;
    const onScroll = () => close();
    const onResize = () => close();
    const onBlur = () => close();
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
    };
  }, [ctx, close]);

  // 消失：选区折叠 / 视图切换。监听常驻（不挂 ctx 依赖），靠 ctxRef 读最新值。
  useEffect(() => {
    const onSelectionChange = () => {
      if (!ctxRef.current) return;
      // 拿不到选区（null）也算塌陷：菜单指着的东西已经不在了。
      if (window.getSelection()?.isCollapsed !== false) close();
    };
    const unsubView = useAppStore.subscribe((state, prev) => {
      if (state.activeView !== prev.activeView && ctxRef.current) close();
    });
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      unsubView();
    };
  }, [close]);

  /**
   * 常驻的 Esc 与失败提示。
   *
   * Esc **不能**放进上面那条菜单的 effect 里：点完「朗读这段」菜单就关了，
   * 而那时 Esc 正是唯一顺手的停止键（Radix 的 DismissableLayer 在 document
   * 捕获阶段处理 Esc，所以这里晚于它 —— 门是「有弹层就不接管」，避免一次 Esc
   * 既关弹层又停朗读）。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 弹层开着时 Esc 归 Radix（它在 document 捕获阶段处理），这里不重复响应。
      if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
        return;
      // 两件事都要做：在播就停（菜单大概已经关了），菜单还开着就收。
      if (isSpeaking(useAppStore.getState().selectionSpeech.status)) {
        event.preventDefault();
        stopSelectionSpeech();
      }
      close();
    };
    const unsubError = useAppStore.subscribe((state, prev) => {
      if (state.selectionSpeech.status !== "error") return;
      if (prev.selectionSpeech.status === "error") return; // 只认进入 error 那一下
      // 引擎/桥缺席时用户点了没反应 —— 至少说一句为什么。
      useAppStore.getState().setGlobalNotice({
        id: "selection-read-aloud-failed",
        type: "error",
        message: "",
        messageKey: "messageCard.readAloudFailed",
      });
    });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      unsubError();
    };
  }, [close]);

  // 定位：量到自己的尺寸后再摆。jsdom 里量到的是 0，不影响断言。
  useLayoutEffect(() => {
    if (!ctx || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    const above = ctx.rect.top >= box.height + GAP + 4;
    const top = above ? ctx.rect.top - box.height - GAP : ctx.rect.bottom + GAP;
    const maxLeft = window.innerWidth - box.width - GAP;
    const centered = ctx.rect.left + ctx.rect.width / 2 - box.width / 2;
    setPos({
      top,
      left: Math.max(GAP, Math.min(centered, Math.max(GAP, maxLeft))),
      above,
    });
  }, [ctx]);

  if (!ctx) return null;

  const actions = SELECTION_ACTIONS.filter(
    (action) => !ctx.inDialog || action.visibleInDialog,
  );

  return (
    <div
      ref={boxRef}
      data-testid="selection-menu"
      data-selection-menu="1"
      role="menu"
      // 顶栏那 40px 是 app-region: drag，压在上面时点击会被 Electron 吞掉。
      className={`${MENU_PANEL_PADDED_CLASS} ${
        pos?.above ? "animate-menu-in-down" : "animate-menu-in-up"
      } titlebar-no-drag fixed z-[70] flex flex-wrap items-center`}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onMouseDown={(event) => {
        // 保住视觉选区（复制失败时 Cmd+C 仍有东西可复制），也不把焦点抢走。
        event.preventDefault();
      }}
    >
      {actions.map((action) => {
        const disabled = action.enabledWhen
          ? !action.enabledWhen(ctx, runtime)
          : false;
        const labelKey = action.labelKeyWhen?.(ctx, runtime) ?? action.labelKey;
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            data-testid="selection-menu-item"
            data-action={action.id}
            disabled={disabled}
            className={`${MENU_ITEM_BAR_CLASS} ${
              disabled
                ? "cursor-not-allowed text-muted-foreground opacity-50"
                : MENU_ITEM_DEFAULT_CLASS
            }`}
            onClick={() => {
              close();
              void action.run(ctx);
            }}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
