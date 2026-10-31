import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VoiceStatus } from "../hooks/useVoiceInput";

/**
 * 录音条：卡片内、编辑器上方那一行。
 *
 * 为什么不在麦克风按钮里：那一格只有 36px，塞进「5 条波形 + 计时」会把它撑成 80px
 * 胶囊。底栏左簇是左锚定的，多出来的宽度直接从编辑区抢；右锚定的宿主
 * （AskUserVoiceField）更糟 —— 胶囊向左长，盖住正在输入的文字。分屏到 15% 宽
 * （MIN_RATIO）时连发送键都会被挤出可视区。
 *
 * 位置与 AttachmentTiles 同一套语义：都在卡片内、都在编辑器上方，都让卡片变高
 * 而不是把按钮推走。
 *
 * 可见条件里为什么有 `polishing`：整理跑在 `status` 已经回到 `idle` 之后
 * （`useVoiceInput` 的 teardown 先收状态，再 schedulePolish），而文字正是在那一刻
 * 落进编辑器。只看 status 就等于在文字落地的同一帧抽掉这 28px，编辑器整块上跳。
 */
export interface VoiceRecordingStripProps {
  status: VoiceStatus;
  /** 0..1，录音时的实时响度。 */
  level: number;
  seconds: number;
  /**
   * 这段文字还有一次整理在等（`useVoiceInput` 的 `polishing`）。
   *
   * 必须单独传：整理跑在 `status` 已经回到 `idle` **之后**（teardown 先收状态，
   * 再 schedulePolish），而转写文字正是在那一刻落进编辑器。只看 status 就等于在
   * 文字落地的同一帧抽掉这 28px，编辑器整块上跳。
   */
  polishing: boolean;
}

/** 波形槽位。固定 5 根，槽位号本身是常量，所以 key 不用数组序号。 */
const LEVEL_SLOTS = [0, 1, 2, 3, 4] as const;

/** 静音与空槽的保底高度（百分比）。不保底的话条会半截空着。 */
const LEVEL_FLOOR = 12;

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 把最近 5 个电平采样摊成波形，最左最旧、最右最新，返回值是百分比高度。
 *
 * 电平每 100ms 才跳一次（采集 worklet 每 100ms 交一片音频），要读出「波形」只能靠
 * 时间差：5 根条各代表一个 100ms 采样。用同一个值乘 5 个系数只会让整块一起缩放 ——
 * 那是柱状图在抖，不是波形。
 *
 * `active` 假时不再吃新采样，也不清空：收尾（finishing）要冻住最后那一格。
 */
function useLevelBars(level: number, active: boolean): number[] {
  const [samples, setSamples] = useState<number[]>([]);

  useEffect(() => {
    if (!active) return;
    setSamples((prev) =>
      // 与上一个相同就不推：StrictMode 下 effect 会双跑，静止时也不该刷帧。
      // 代价是完全恒定的电平不会填满 5 根条 —— 真实 RMS 不会逐帧一模一样，够不着。
      prev[prev.length - 1] === level
        ? prev
        : [...prev, level].slice(-LEVEL_SLOTS.length),
    );
  }, [level, active]);

  const missing = Math.max(0, LEVEL_SLOTS.length - samples.length);
  const padded: number[] = [
    ...Array.from({ length: missing }, () => 0),
    ...samples,
  ];
  return padded.map((value) => Math.max(LEVEL_FLOOR, Math.round(value * 100)));
}

/**
 * 这一行什么时候该在：录音、收尾、以及收尾之后的整理。
 *
 * `polishing` 只在 `idle` 时算（整理跑在 status 回到 idle 之后）。`requesting`
 * 期间引擎正在起、`polishing` 还没来得及熄灭 —— 那一刻报"正在整理文字"是假的，
 * 也与麦克风自己（它不给 busy 画 polish 环）不一致。
 */
export function shouldShowRecordingStrip(
  status: VoiceStatus,
  polishing: boolean,
): boolean {
  return (
    status === "recording" ||
    status === "finishing" ||
    (polishing && status === "idle")
  );
}

export function VoiceRecordingStrip({
  status,
  level,
  seconds,
  polishing,
}: VoiceRecordingStripProps) {
  const { t } = useTranslation();
  // 只有录音中吃采样：收尾与整理都冻住最后一格（active 为假时 hook 既不推也不清）。
  const bars = useLevelBars(level, status === "recording");
  if (!shouldShowRecordingStrip(status, polishing)) return null;

  // 录音优先：两者几乎不会同时为真（runPolish 在录音中会熄灭 polishing），
  // 万一撞上，报更具体的那个。
  const phase =
    status === "recording"
      ? "listening"
      : status === "finishing"
        ? "stopping"
        : "polishing";

  return (
    <div
      data-testid="voice-recording-strip"
      className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground"
    >
      {phase === "polishing" ? (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 flex-none animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-transparent"
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 flex-none rounded-full bg-destructive"
        />
      )}
      {/* 整理期间 teardown 已经把 seconds 清零，显示 0:00 就是撒谎 */}
      {phase === "polishing" ? null : (
        <span className="flex-none tabular-nums">{formatSeconds(seconds)}</span>
      )}
      {/* 波形条 aria-hidden：它的含义已经在按钮的可访问名（「停止录音」）里。
          高度走 inline style —— 电平是运行时数据，Tailwind 不能穷举。 */}
      <span
        className={`flex h-3 flex-none items-end gap-[2px] ${
          phase === "polishing" ? "opacity-45" : ""
        }`}
        aria-hidden="true"
      >
        {LEVEL_SLOTS.map((slot) => (
          <span
            key={slot}
            data-testid="voice-strip-level-bar"
            className="w-[3px] rounded-full bg-muted-foreground transition-[height] duration-150 ease-out"
            style={{ height: `${bars[slot]}%` }}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {/* 每条提示只能许诺真的还能按的键：收尾与整理时 Esc 都不会取消。
            整理态复用麦克风的「正在整理文字…」—— 这是同一件事的两个位置。 */}
        {phase === "listening"
          ? t("chat.voiceRecordingHint")
          : phase === "polishing"
            ? t("chat.voicePolishing")
            : null}
      </span>
    </div>
  );
}
