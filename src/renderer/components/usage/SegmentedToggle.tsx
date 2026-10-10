import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  testId?: string;
}

/**
 * 用量页的紧凑档单选分段控件。
 *
 * 为什么有这一层：三个调用点（区间 / 排序 / 热力图配色）是同一形态，而 vendored 的
 * `ToggleGroup` 只有行为与结构、没有尺寸档 —— 把 `h-8 px-2 text-xs` 抄三遍就等于又回到
 * 「共享的只是类名」（shadcn 迁移要解决的正是这个）。
 *
 * 两条形态决策（2026-10-10 用户选定的「方案 A」，见设计图 ③）：
 * ① **不要灰底导轨**：shadcn 的 ToggleGroup 就是裸按钮 + `gap-1`；旧实现那圈 `bg-muted`
 *    圆角框是自研外壳。
 * ② 未选中项要 `data-[state=off]:hover:bg-muted/60`：上游 base 的 hover 是 `bg-muted`，
 *    而官方主题里 `--muted` 与选中态用的 `--accent` **同值** ⇒ 不压一档的话「悬停」看起来
 *    就是「选中」。⚠️ 用 `data-[state=off]:` 前缀是为了**特异性**（类 + 属性 + 伪类），不是
 *    靠样式表顺序 —— 同特异性的 `hover:bg-muted` 谁赢要看去重后的生成顺序，不可靠。
 */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  testId,
}: Props<T>) {
  return (
    <ToggleGroup
      type="single"
      // 单选语义由 Radix 给：type="single" ⇒ 根 role="radiogroup"，档位 role="radio" +
      // aria-checked，Tab 只进组一次、方向键在档位间移动、空格/回车选中。
      value={value}
      // ⚠️ 再点当前项时 Radix 会回传 ""（取消选中）。必须丢掉：受控 value 不变 ⇒ 档位保持
      // 选中，也不会把 query 打成一个不存在的 range。（Radix 的类型是 `(value: string)`，
      // 而 T 是它的子集，所以这里需要一次断言。）
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      data-testid={testId}
      // flex-wrap 对齐旧实现在窄窗口下的换行行为；justify-start 对齐旧实现的左对齐
      // （上游 base 是 justify-center，换行后居中的样子与旧分段控件不同）。
      className="flex-wrap justify-start gap-1"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          size="sm"
          className="h-8 px-2 text-xs text-muted-foreground data-[state=off]:hover:bg-muted/60"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
