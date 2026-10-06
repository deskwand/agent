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
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, X } from "lucide-react";
import { StarOrb } from "./voice-mode/star-orb";
import { CAPTION_KEY, ORB_STATE } from "./voice-mode/orb-state";
import { isNearBottom, stripVoiceMarkers } from "../utils/voice/voice-caption";
import { VOICE_MESSAGE_KEYS } from "../hooks/useVoiceInput";
import type { VoiceModeView } from "../hooks/useVoiceMode";

export interface VoiceModeOverlayProps {
  /** 运行时给出的视图状态。浮层只画，不管。 */
  view: VoiceModeView;
  onClose(): void;
  onMinimize(): void;
}

/** 顶部渐隐只在真的能往上滚时出现（留一点余量，避免像素抖动）。 */
const TOP_FADE_AT_PX = 8;

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
  // 浮层跟着重渲染 —— 不缓存就会每帧反复跑正则。
  const answerText = useMemo(
    () => stripVoiceMarkers(view.answer),
    [view.answer],
  );
  // 识别中显示你自己的话；其余状态有回答就显示回答，还没有才回落到问题。
  // 「还没有」不只是 thinking 期间：整轮无可朗读文本时（纯代码块），状态机会
  // 从 thinking 直接回 listening，只认状态的话这段回答一次都上不了屏。
  const showAnswer = view.state !== "capturing" && answerText.length > 0;
  const text = showAnswer ? answerText : view.transcript;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 是否跟随最新文字。用户上翻后为 false，滚回底部再恢复。 */
  const pinnedRef = useRef(true);
  const [showTopFade, setShowTopFade] = useState(false);

  // 文字增加就贴到底。用户上翻过就不动 —— 阅读的人不该被新文字拽走。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (text.length === 0) {
      // 新一轮开始：文字清空的同时恢复跟随（上一轮可能被上翻过）。渐隐也要显式
      // 关掉 —— 内容收缩时浏览器会钳制滚动位置，未必补发 scroll 事件。
      pinnedRef.current = true;
      el.scrollTop = 0;
      setShowTopFade(false);
      return;
    }
    if (!pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = isNearBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    );
    setShowTopFade(el.scrollTop > TOP_FADE_AT_PX);
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
        <StarOrb state={ORB_STATE[view.state]} level={view.level} />
      </div>

      <p className="mt-2 text-sm" style={{ color: "#8f8f9b" }}>
        {caption}
      </p>

      {/*
        文字区定高。它永远占位，即使一个字都没有 —— 否则球会随文字增减上下跳。
        高度上限 12rem（约 6 行），小窗口按 22vh 收缩，下限 6rem。
      */}
      <div className="relative mt-6 h-[clamp(6rem,22vh,12rem)] w-full">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          data-testid="voice-caption-text"
          className={`h-full overflow-y-auto px-8 text-lg leading-relaxed [scrollbar-width:none] ${
            showAnswer ? "text-left" : "text-center"
          }`}
          // 滚动条不显示：沉浸场景，滚动状态由顶部渐隐表达。line-break 收敛
          // 中文行首禁则；break-word 让长 URL 折行而不是撑破容器。
          style={{
            color: "#e7e7ea",
            lineBreak: "strict",
            overflowWrap: "break-word",
          }}
        >
          <p className="mx-auto max-w-[34rem] whitespace-pre-wrap">{text}</p>
        </div>
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 h-7 bg-gradient-to-b from-[#050507] to-transparent transition-opacity duration-200 ${
            showTopFade ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
    </div>
  );
}
