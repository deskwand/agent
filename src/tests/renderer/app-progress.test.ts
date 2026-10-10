// @vitest-environment jsdom
//
// `app-progress.tsx` 的组件级测试。仓库里没有 .tsx 测试文件，且 vitest 的 include
// 只收 `{js,ts}`（见 activity-strip-chip.test.ts 的文件头）—— 所以这里用
// React.createElement，不写 JSX。
//
// 这个包装层存在的唯一理由是 vendored `ui/progress.tsx` 的两个实测行为：
// ① 它把 `value` 只用于算 Indicator 的位移、**不转给 Root** ⇒ 不写回 aria 就
//    只剩 `data-state="indeterminate"`（没有 `aria-valuenow`）；
// ② 位移只认 0–100 的百分比 ⇒ 领域值必须先换算。
// 下面是这两条各自的钉子 —— 缺了它们，回归的表现是「视觉反了」或「读屏读不到进度」，
// 两者都不会让类型检查或其它渲染测试变红。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppProgress } from "../../renderer/components/app-progress";

describe("AppProgress", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const bar = () => container.querySelector("[role='progressbar']")!;
  const fill = () => bar().querySelector("div")!.getAttribute("style") ?? "";

  function render(value: number, max: number) {
    act(() =>
      root.render(
        React.createElement(AppProgress, {
          value,
          max,
          className: "h-1 w-[34px]",
        }),
      ),
    );
  }

  it("把领域值换算成百分比（2/9 —— 位移必须按 22.2% 算，不是 100 − 2 = 98%）", () => {
    render(2, 9);
    expect(fill()).toContain("translateX(-77.7");
    expect(fill()).not.toContain("translateX(-98%)");
  });

  it("区间语义写回 aria（vendored 不转 value ⇒ Root 默认是 indeterminate）", () => {
    render(2, 9);
    expect(bar().getAttribute("aria-valuenow")).toBe("2");
    expect(bar().getAttribute("aria-valuemax")).toBe("9");
    expect(bar().getAttribute("aria-valuemin")).toBe("0");
  });

  it("调用方的 className 能压住 vendored 的 h-2 w-full（cn 去重）", () => {
    render(2, 9);
    expect(bar().classList.contains("h-1")).toBe(true);
    expect(bar().classList.contains("w-[34px]")).toBe(true);
    expect(bar().classList.contains("h-2")).toBe(false);
    expect(bar().classList.contains("w-full")).toBe(false);
  });

  it("max <= 0 时按 0% 处理（不产生 NaN / 除零），且不报非法区间", () => {
    render(0, 0);
    expect(fill()).toContain("translateX(-100%)");
    // ⚠️ 这里**不能**断言 `aria-valuemax === "0"` ✗（审查指出：第一版正是这么写的 ✓）：
    // ARIA 要求 `valuemax > valuemin`，报 0 就是报了一个非法区间 —— 等于把「区间无意义」
    // 这个事实说成「范围是 0 到 0」。正确口径是**不输出**这两个属性（让 Radix 自己的
    // indeterminate 接管）。
    expect(bar().hasAttribute("aria-valuemax")).toBe(false);
    expect(bar().hasAttribute("aria-valuenow")).toBe(false);
  });

  it("语义也跟着视觉一起锅（否则画的是一回事、告诉读屏的是另一回事）", () => {
    // 视觉被锅到 0–100%，所以 valor > max / < 0 时 aria 照原值输出就是非法区间。
    render(20, 9);
    expect(bar().getAttribute("aria-valuemax")).toBe("9");
    expect(bar().getAttribute("aria-valuenow")).toBe("9");
    render(-3, 9);
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
  });
});
