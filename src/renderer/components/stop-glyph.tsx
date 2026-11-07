/**
 * 「停止」字形：一枚实心圆角方块。
 *
 * **两个宿主共用这一份**：输入卡右簇的停止键（`ChatInputBottomBar`）与麦克风那格的
 * 录音停止键（`VoiceMicButton`）。同一个概念在同一张卡里出现两次，曾经是两个字形
 * ——16px 描边红方块 vs 16px 白色实心块——同屏出现时像两个不同的按钮。
 *
 * 为什么手画 `rect` 而不是 lucide 的 `Square`：后者的圆角写死在自己的 path 里
 * （rx 2/24），12px 下只剩 1px，看着就是一枚直角块；这里的 rx 是 6/24 = 边长的 25%，
 * 随尺寸等比缩。
 *
 * 为什么只填不描：描边版在 12px 下看着是个空心的框，「停止」读不出来；而且实心块与
 * 描边图标外框相同时，实心那块永远读着更大（16px 实心 256px² 墨量 vs 16px `Mic`
 * 的 55px²），所以它必须比旁边的描边图标小一档。
 *
 * ⚠️ 尺寸**不在这个文件里**，两个宿主都得在自己那颗 `<Button>` 上写 `[&_svg]:size-3`：
 * `Button` base 带 `[&_svg]:size-4`（编译成 `.cls svg` = 0,1,1），svg 自己写的单类名
 * `w-3`（0,1,0）赢不过它 —— 写在这枚 svg 上的任何尺寸类都会被顶成 16px。
 * 两处必须同时是 `size-3`（`ChatInputBottomBar` 与 `VoiceMicButton` 的
 * `buttonClassName`）；写成 `[&_svg]:${常量}` 也不行，tailwind 只认字面量。
 */
export function StopGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="none"
    >
      <rect width="24" height="24" rx="6" />
    </svg>
  );
}
