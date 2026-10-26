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
 * 用量页的档位单选：**官方 `ui/toggle-group` 的薄转发**。
 *
 * 这里只做三件官方 API 覆盖不到的事，不含任何皮肤：
 * ① 把 `type="single"` 的 `string` 收窄回调用点的 union（Radix 的类型就是 string）；
 * ② 丢掉 `""` —— 再点当前档位时 Radix 会回传空串（取消选中），受控 value 必须保持不变；
 * ③ 透传 `data-testid` 给既有用例。
 *
 * ⚠️ 皮肤一律来自 `ui/toggle-group.tsx` / `ui/toggle.tsx`（`size="sm"` 是官方尺寸档，
 * 选中态底由官方 base 换成仓库的 `data-[state=on]:bg-selected-surface`）。调用点**不要**再手写
 * `h-8 px-2 text-xs` 或自造 hover —— 那正是「迁移到 shadcn 却又自己造一套」的老问题。
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
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      size="sm"
      data-testid={testId}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
