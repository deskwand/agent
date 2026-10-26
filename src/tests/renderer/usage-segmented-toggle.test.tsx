// @vitest-environment jsdom
//
// `SegmentedToggle` 的**行为**网（不是字符串断言）：role/aria、点击回传、
// 「点当前项不许把档位清空」、以及「没有灰底导轨」。
//
// 为什么它比页面级断言值钱：三个调用点（区间 / 排序 / 热力图配色）共用这一个原语，
// 页面换结构时这层网仍然盯着它。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentedToggle } from "../../renderer/components/usage/SegmentedToggle";

const OPTIONS = [
  { value: "1d", label: "今天" },
  { value: "7d", label: "7 天" },
] as const;

describe("SegmentedToggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function Harness({ onChange }: { onChange: (value: string) => void }) {
    const [value, setValue] = React.useState<"1d" | "7d">("1d");
    return (
      <SegmentedToggle
        value={value}
        testId="seg"
        options={OPTIONS}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }

  async function render(onChange: (value: string) => void = () => {}) {
    await act(async () => {
      root.render(<Harness onChange={onChange} />);
    });
  }

  const group = () =>
    container.querySelector<HTMLElement>('[data-testid="seg"]')!;
  const item = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).find(
      (node) => node.textContent === label,
    )!;

  it("渲染成 radiogroup + radio，选中项带 aria-checked", async () => {
    await render();
    // Radix 1.1.20 的 dist 里 type="single" 的根就是 role="radiogroup"
    expect(group().getAttribute("role")).toBe("radiogroup");
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(item("今天").getAttribute("aria-checked")).toBe("true");
    expect(item("7 天").getAttribute("aria-checked")).toBe("false");
  });

  it("点未选中档位回传它的值，选中态跟着走", async () => {
    const onChange = vi.fn();
    await render(onChange);
    await act(async () => {
      item("7 天").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("7d");
    expect(item("7 天").getAttribute("aria-checked")).toBe("true");
  });

  it('点当前档位不回传空值（Radix 单选会回传 ""）', async () => {
    const onChange = vi.fn();
    await render(onChange);
    await act(async () => {
      item("今天").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(item("今天").getAttribute("aria-checked")).toBe("true");
  });

  it("皮肤全部来自官方原语：不再手写尺寸与 hover", async () => {
    await render();
    // 官方 ToggleGroup 本身就没有灰底导轨（只有 flex + gap），这条继续成立
    expect(group().className).not.toMatch(/(?:^|\s)bg-muted(?:\s|$)/);
    // 选中态来自 ui/toggle.tsx 的官方 base
    expect(item("7 天").className).toContain(
      "data-[state=on]:bg-selected-surface",
    );
    // 调用点不得再手写尺寸档或自造 hover（曾经是 h-8 px-2 text-xs + data-[state=off]:hover:bg-muted/60）
    expect(item("7 天").className).not.toContain(
      "data-[state=off]:hover:bg-muted/60",
    );
    expect(item("7 天").className).not.toContain("text-xs");
    expect(item("7 天").className).toContain("h-8"); // 官方 size="sm"
  });
});
