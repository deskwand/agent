/**
 * @module renderer/components/VoiceModeOverlay
 *
 * 全屏浮层：球居中，胶囊在顶，字幕在球下，右上角最小化 + 关闭。
 * 浮层不拖历史 —— 那是文字界面的活（设计 §3.1）。当轮文字自己滚动，
 * 见 `design-docs/2026-10-06-voice-caption-text-design.md`。
 *
 * **纯展示**：运行时在 `voice-mode/VoiceModeHost` 里，这里只画它给的状态，
 * 所以最小化 / 回到全屏都不会重启麦克风。
 */
import { useEffect, useMemo, useRef } from "react";
import type { WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { Minus, X } from "lucide-react";
import { GLOW_BRUSH, StarOrb } from "./voice-mode/star-orb";
import { CAPTION_KEY, ORB_STATE } from "./voice-mode/orb-state";
import { voiceCaptionLine } from "../utils/voice/voice-caption";
import { VOICE_MESSAGE_KEYS } from "../hooks/useVoiceInput";
import type { VoiceModeView } from "../hooks/useVoiceMode";

export interface VoiceModeOverlayProps {
  /** 运行时给出的视图状态。浮层只画，不管。 */
  view: VoiceModeView;
  onClose(): void;
  onMinimize(): void;
}

export function VoiceModeOverlay({
  view,
  onClose,
  onMinimize,
}: VoiceModeOverlayProps): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const caption = view.error
    ? t(VOICE_MESSAGE_KEYS[view.error])
    : t(CAPTION_KEY[view.state]);

  // 回答按纯文本显示，先去掉 markdown 标记。`level` 每 100ms 更新一次，会让
  // 浮层跟着重渲染 —— 不缓存就会反复跑正则。
  // 依赖逐个列出而不是整个 view：view 每次 patch 都是新对象，那样 memo 等于没写。
  const { state, transcript, answer, spoken } = view;
  const text = useMemo(
    () => voiceCaptionLine({ state, transcript, answer, spoken }),
    [state, transcript, answer, spoken],
  );

  const lineRef = useRef<HTMLDivElement | null>(null);

  // 换一个合成单元就把横向位置复位到句首：上一段滑到一半的位置留给下一段没有意义。
  useEffect(() => {
    const el = lineRef.current;
    if (el) el.scrollLeft = 0;
  }, [text]);

  /**
   * 纵向滚轮横着用：一块只能横滚的区域，滚轮落在上面不该毫无反应。
   * 比主轴而不是判 deltaX !== 0：触控板斜向手势两个轴同时非零，只认 deltaX 会把
   * 大半的纵向分量丢掉（实测 (30,120) 只横移 30px）。
   */
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = lineRef.current;
    if (!el) return;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return; // 横向为主：交给浏览器
    el.scrollLeft += event.deltaY;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden"
      // 固定深色底，不跟主题走：星空球是按深色底定稿的（设计 §3.1 的原型就是
      // #050507）。浅色主题下粒子与光晕会糊成一块脏斑 —— 沉浸式场景固定深底是
      // 常规做法，这里不是漏了主题适配。
      style={{ backgroundColor: "#050507" }}
    >
      {/* `titlebar-no-drag` 不是装饰：按钮上边距 16px、高 36px，跨在标题栏 40px 高的
          拖窗区里。拖窗命中是矩形，也不看 z-index —— 浮层盖在标题栏上不等于把这块
          从拖窗区里抠出来：以前能点全靠标题栏右簇自己那块 no-drag 恰好盖到 y=34，
          y=34–40 这 6px 仍是拖窗区，点击落在✕中间就被当成拖窗吞掉（悬停照常亮）。
          两个按钮现在都在这里，都得带这个类。 */}
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <button
          type="button"
          data-testid="voice-minimize"
          onClick={onMinimize}
          aria-label={t("voiceMode.minimize")}
          className="titlebar-no-drag flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-white/10"
          style={{ color: "#8f8f9b" }}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="voice-close"
          onClick={onClose}
          aria-label={t("voiceMode.exit")}
          className="titlebar-no-drag flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-white/10"
          style={{ color: "#8f8f9b" }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="h-[min(620px,62vh)] w-[min(620px,86vw)]">
        <StarOrb
          brush={GLOW_BRUSH}
          state={ORB_STATE[view.state]}
          level={view.level}
        />
      </div>

      <p className="mt-2 text-sm" style={{ color: "#8f8f9b" }}>
        {caption}
      </p>

      {/*
        只显示正在念的那个合成单元（规则在 `voiceCaptionLine` 里）。定高一行：高度恒定，
        所以球不会随文字增减上下跳 —— 以前靠一个高框占位，现在一条线就够。
        放不下就横向滚（不折行）：`max-w-[34rem]` 限的是盒子、不是可见行宽 ——
        超长文本从盒子右边缘溢出，而盒子仍保持居中，所以句首始终在左边、尾部靠滚动
        拿到（四档窗口宽度在本机 Chrome 实测过）。`margin: auto` 塌成 0 是另一回事，
        只在容器本身窄于 34rem 时发生。
      */}
      <div className="mt-6 h-10 w-full">
        <div
          ref={lineRef}
          onWheel={handleWheel}
          data-testid="voice-caption-text"
          className="h-full overflow-x-auto overflow-y-hidden px-8 text-lg leading-relaxed [scrollbar-width:none]"
          style={{ color: "#e7e7ea" }}
        >
          <span className="mx-auto block max-w-[34rem] text-center whitespace-nowrap">
            {text}
          </span>
        </div>
      </div>
    </div>
  );
}
