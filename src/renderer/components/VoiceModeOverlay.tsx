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
import { useEffect, useMemo } from "react";
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
        只显示正在念的那个合成单元（规则在 `voiceCaptionLine` 里）。定宽、居中、折行、定高，
        四条都是必需的，不是风格选择：
        · 定宽 `max-w-[34rem]`（约 36 汉字/行）：不限宽就是一行铺满整个窗口。
        · 折行：定宽之后就**必须**折行。`whitespace-nowrap` 会把超长文本从盒子左沿往右溢出，
          于是放得下也不居中（实测：1560px 窗口里 975px 那行左 509 / 右 78，偏 431px）。
          「卡窄盒子」与「不折行」不能共存，这是同一个不变量的两面。
        · 定高：浮层是 justify-center 的列，高度一变球就跳。`h-12` 必须配 `leading-6`
          （24 × 2 = 48 整除）：高度不是行高的整数倍时，第三条线会在盒子下沿切出一条
          2–3px 的字头（`h-14` 配 `leading-relaxed` 的 24.375 就切）。
        · key 用 `spoken` 而**不是** `text`：换单元重挂载 → 滚动位置自然回顶；而 `answer`
          回落那一路 `text` 每 token 都变，拿它当 key 会把用户正在滚的位置每 100ms 拽回顶部。
        `break-words` 也是承重的：没它时长 URL / 长 ASCII 会横向溢出（实测 200 字 URL
          溢出 61px），而 `[scrollbar-width:none]` 又把横滚条藏了。

        超出定高的超长单元（合成单元上限 600 字 ≈ 17 行）在框内纵向滚。不加顶部渐隐：
        它只是「下面还有」的提示，内容本来就滚得到。
      */}
      <div
        key={spoken}
        data-testid="voice-caption-text"
        className="mx-auto mt-6 h-12 max-w-[34rem] overflow-y-auto whitespace-pre-wrap break-words text-center text-lg leading-6 [scrollbar-width:none]"
        // pre-wrap 对常见路径是空的（合成单元里的空白已被 `speech-text.ts` 的
        // `replace(/\s+/g, " ")` 压成单空格），但对 `answer` 回落分支是必需的：
        // 那里是 markdown 原文，段落靠 \n 分（实测 pre-wrap 6 行 vs 折行版 1 行）。
        style={{ color: "#e7e7ea", lineBreak: "strict" }}
      >
        {text}
      </div>
    </div>
  );
}
