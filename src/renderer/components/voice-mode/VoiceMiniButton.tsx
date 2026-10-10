/**
 * @module renderer/components/voice-mode/VoiceMiniButton
 *
 * header 里的语音入口：一颗**活的**星球球（24px 画布），悬停 / 键盘聚焦向下弹出
 * 卡片 —— 球、字幕、静音、结束都在卡片里。
 *
 * 为什么现在能容纳这颗球，而 2026-10-08 那版说「不做」：球界半径
 * `R = min(W,H) * 0.335`，24px 画布下球界直径正好 16px —— 与换掉的那颗圆点同尺寸，
 * 但它是真的那颗星球。小尺寸读得出来的前提是换一支专为图标调的画笔：
 * 300 颗星在 16px 球里是一坨噪点（实测探针 `design-docs/star-orb-size/`），
 * 所以图标用 `STARS_BRUSH_ICON_*`（64 颗、粒子 1.5×、弱描边）。
 * 代价是顶栏多一个 canvas，所以 `StarOrb` 在 reduced-motion 下只画一帧、不起循环。
 *
 * 卡片里那颗用 40px 那档画笔（300 颗，62px 画布下才看得见星空），而且**只在指针 /
 * 键盘真进到卡片里时才挂上** —— 卡片一直挂在 DOM 里靠 CSS 显隐，不这样处理就是一颗
 * 300 颗粒子的球全程空转。
 *
 * 字幕与球的状态都由宿主算好发布（`voiceMiniCaption` / `voiceMiniState`），这里零规则。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, MicOff, X } from "lucide-react";
import { useAppStore } from "../../store";
import { useEffectiveTheme } from "../../store/selectors";
import { TitlebarButton } from "../TitlebarButton";
import { ORB_STATE } from "./orb-state";
import {
  StarOrb,
  STARS_BRUSH_DARK,
  STARS_BRUSH_ICON_DARK,
  STARS_BRUSH_ICON_LIGHT,
  STARS_BRUSH_LIGHT,
} from "./star-orb";
import { Button } from "../app-button";

/** 卡片里那一行控件的统一样式。 */
const CARD_CONTROL_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

export function VoiceMiniButton(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.voiceModeOpen);
  const caption = useAppStore((s) => s.voiceMiniCaption);
  const miniState = useAppStore((s) => s.voiceMiniState);
  // 球按主题换画笔：浅底画深粒子、深底画浅粒子。全屏那颗不受主题影响（永远深底）。
  const isDark = useEffectiveTheme() === "dark";
  // 卡片是 CSS 显隐、一直挂在 DOM 里；里面那颗球是 canvas，所以只在指针 / 键盘真进到
  // 卡片里时才挂上，离开就卸掉 —— 否则一颗 300 颗粒子的球会全程空转。
  const [cardOpen, setCardOpen] = useState(false);
  const activeView = useAppStore((s) => s.activeView);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const voiceSessionId = useAppStore((s) => s.voiceModeSessionId);
  const minimized = useAppStore((s) => s.voiceModeMinimized);
  const muted = useAppStore((s) => s.voiceModeMuted);
  const setMuted = useAppStore((s) => s.setVoiceModeMuted);
  const setMinimized = useAppStore((s) => s.setVoiceModeMinimized);
  const closeVoiceMode = useAppStore((s) => s.closeVoiceMode);
  // 全屏浮层打开时不渲染这个图标：卡片是 z-[60]（要压过产物面板的 z-50），
  // 而浮层是 z-50 且 Header 的祖先不产生层叠上下文 —— 卡片会浮在沉浸式浮层之上。
  // 收起（minimized）之后图标立刻回来。
  const overlayOpen =
    voiceSessionId !== null &&
    activeView === "chat" &&
    activeSessionId === voiceSessionId &&
    !minimized;
  if (!open || caption === null || overlayOpen) return null;

  // state 缺失（宿主还没写 / 已清空）时落到 listening：图标不许崩，也不许空着
  const orbState = ORB_STATE[miniState ?? "listening"];
  const iconBrush = isDark ? STARS_BRUSH_ICON_DARK : STARS_BRUSH_ICON_LIGHT;
  const cardBrush = isDark ? STARS_BRUSH_DARK : STARS_BRUSH_LIGHT;

  return (
    <div
      data-testid="voice-mini-widget"
      className="titlebar-no-drag group relative"
    >
      <TitlebarButton
        label={t("voiceMode.expand")}
        isOn
        hideTooltip
        onClick={() => setMinimized(false)}
      >
        {/* 24px 画布 → 球界直径 ≈16px，与换掉的那颗圆点同尺寸，但它是真的那颗星球。
            level 固定 0：麦克风电平被刻意留在宿主里（高频值不进 store）。自转 / 俯仰 /
            湍流都是时间驱动的，照样转；丢掉的只有音量响应 —— speaking 档
            `energy = level * 0.3`，满电平也只让亮度 +30%、核心半径 +18%，看不出来。 */}
        <span data-testid="voice-mini-orb" className="block h-6 w-6">
          <StarOrb brush={iconBrush} state={orbState} level={0} />
        </span>
      </TitlebarButton>

      <div
        data-testid="voice-mini-card"
        /* z-[60]：要盖过内容区右上的产物面板（`ArtifactPanel.tsx` 是 z-50），
           又必须低于灯箱（z-[100]）。`titlebar-no-drag` 写在卡片自己身上，
           不靠祖先继承 —— 断言要能直接看见它。 */
        className="titlebar-no-drag invisible absolute right-0 top-full z-[60] w-[20rem] pt-2 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        onMouseEnter={() => setCardOpen(true)}
        onMouseLeave={() => setCardOpen(false)}
        onFocus={() => setCardOpen(true)}
        onBlur={(event) => {
          // onBlur 会**冒泡**：焦点在卡片内部从一颗按钮移到另一颗也会走到这里。
          // 那时球不该被拆掉重建（300 颗粒子白建一次，还可能闪一帧）。
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setCardOpen(false);
        }}
      >
        <div className="rounded-xl border border-border/40 bg-background/95 p-2.5 shadow-elevated backdrop-blur">
          <div className="flex gap-2.5">
            {/* 槽位先占着、球后挂：不然悬停的瞬间卡片会跳一下 */}
            <span className="block h-[62px] w-[62px] shrink-0">
              {cardOpen ? (
                <StarOrb brush={cardBrush} state={orbState} level={0} />
              ) : null}
            </span>
            <p
              data-testid="voice-mini-caption"
              className="text-xs leading-[1.6] text-muted-foreground"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {caption}
            </p>
          </div>
          <div className="mt-2 flex items-center justify-center gap-1 border-t border-border/40 pt-1.5">
            <Button variant="ghost"
              type="button"
              data-testid="voice-mini-mute"
              aria-label={
                muted ? t("voiceMode.unmuteMic") : t("voiceMode.muteMic")
              }
              onClick={() => setMuted(!muted)}
              className={CARD_CONTROL_CLASS}
            >
              {muted ? (
                <MicOff className="h-3.5 w-3.5 hover:bg-transparent hover:text-current" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button variant="ghost"
              type="button"
              data-testid="voice-mini-end"
              aria-label={t("voiceMode.endVoice")}
              onClick={closeVoiceMode}
              className={`${CARD_CONTROL_CLASS} hover:text-destructive`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
