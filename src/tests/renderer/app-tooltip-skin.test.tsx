// @vitest-environment jsdom
//
// 气泡皮肤的**应用侧覆写真的生效**吗？
//
// 这是本轮唯一能证明它的断言：vendored 的 `ui/tooltip.tsx` 里写死了
// `bg-primary` / `text-primary-foreground` ✗，而 `app-tooltip.tsx` 的 `TooltipContent`
// 包装层靠 `cn` 的冲突合并把它们挤成 `--secondary` 那一对 ✓。
// 源码级断言证明不了这件事（它只能证明「传了类名」，证不了「合并后谁赢」）⇒
// 这里读**真实渲染出来的** className。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../renderer/components/app-tooltip";

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

async function renderBubble(className?: string) {
  await act(async () =>
    root.render(
      <Tooltip open>
        <TooltipTrigger asChild>
          <button type="button">x</button>
        </TooltipTrigger>
        {/* 用受控 `open` 让它**同步**渲出来：本用例断的是**类名链**，不是开合行为
           （hover/focus 的开合由 Radix 负责），所以不引入计时器让它变脆。
            ⚠️ 别改用 `forceMount` —— 实测 Radix 1.3.0 下它无效，气泡根本不渲（只剩触发器）。 */}
        <TooltipContent className={className}>文案</TooltipContent>
      </Tooltip>,
    ),
  );
  const bubble = document.body.querySelector('[role="tooltip"]');
  expect(bubble, "气泡没渲出来").not.toBeNull();
  return bubble!;
}

describe("气泡皮肤（应用侧覆写）", () => {
  it("渲染出来的是 bg-secondary + text-secondary-foreground", async () => {
    const bubble = await renderBubble();
    // 用 classList 而不是 className.includes：本仓在 `\b` / 子串匹配上栽过
    //（`bg-primary` 会命中 `bg-primary-foreground` 那类写法）。
    expect(bubble.classList.contains("bg-secondary")).toBe(true);
    expect(bubble.classList.contains("text-secondary-foreground")).toBe(true);
  });

  it("vendored 的 bg-primary / text-primary-foreground 真的被挤掉了", async () => {
    const bubble = await renderBubble();
    expect(
      bubble.classList.contains("bg-primary"),
      "vendored 的 bg-primary 没被合并掉",
    ).toBe(false);
    expect(
      bubble.classList.contains("text-primary-foreground"),
      "vendored 的 text-primary-foreground 没被合并掉",
    ).toBe(false);
  });

  it("阴影在：浅色下那 1.09 的色调差不靠它就是不可见的容器", async () => {
    // 审查员 2026-10-10 实测：气泡离 --background 只 1.09，落在侧栏上时只有 **1.04** ✗
    // ⇒ 无阴影时浅色主题看到的是「几行游离的深色文字」而不是一个气泡。
    // 这条把它钉住，免得后人把 `shadow-elevated` 当成多余装饰删掉。
    const bubble = await renderBubble();
    expect(bubble.classList.contains("shadow-elevated")).toBe(true);
  });

  it("调用方自己的 className 仍然能赢（不会被默认皮肤顶掉）", async () => {
    const bubble = await renderBubble("bg-destructive");
    expect(bubble.classList.contains("bg-destructive")).toBe(true);
    expect(bubble.classList.contains("bg-secondary")).toBe(false);
  });
});
