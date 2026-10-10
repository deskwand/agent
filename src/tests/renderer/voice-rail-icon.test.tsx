// @vitest-environment jsdom
//
// 图标栏语音入口的字形归属：它必须是自己的字形，不能和输入框的听写麦克风同形。
// 这里挂真实 AppRail（含底部 HelpMenu / AccountCluster），并把负断言锁在栏内
// （nav[aria-label="navRail.label"]）—— 两个正断言先证明底部簇已挂载，否则
// 那条「栏内没有 svg.lucide-mic」会在「底部根本没渲染」时假通过。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Mic } from "lucide-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppRail } from "../../renderer/components/AppRail";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  // 必须给全 `i18n`（不只是 `t`）：树里会读模块级 i18n 实例的工具
  //（utils/i18n-format.ts）与后续迁移进来的弹窗都靠它。缺它会让整棵渲染树炸掉。
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("语音会话入口用自己的字形，不再和听写麦克风同形", async () => {
  await act(async () =>
    root.render(<AppRail onCreateVoiceSession={() => {}} />),
  );

  const voice = container.querySelector<HTMLButtonElement>(
    'button[aria-label="navRail.newVoiceSession"]',
  );
  expect(voice).not.toBeNull();
  expect(voice!.querySelector("svg.lucide-audio-lines")).not.toBeNull();

  // 底部簇真挂了：否则下面那条栏内负断言只覆盖栏的上半段。
  expect(
    container.querySelector('button[aria-label="help.label"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('button[aria-label="sidebar.user"]'),
  ).not.toBeNull();

  // 图标栏不该再出现麦克风：Mic 只属于输入框的听写。
  const rail = container.querySelector('nav[aria-label="navRail.label"]');
  expect(rail).not.toBeNull();
  expect(rail!.querySelectorAll("svg.lucide-mic")).toHaveLength(0);
});

// 正对照：同一选择器对真正的 lucide Mic 确实命中，上面那条负断言才不是恒真。
it("对照：lucide 的 Mic 在 DOM 里带 lucide-mic 类", async () => {
  await act(async () => root.render(<Mic className="h-4 w-4" />));
  expect(container.querySelectorAll("svg.lucide-mic")).toHaveLength(1);
});

// 禁用态的提示必须还能弹出来。
//
// 实测（2026-10-09）：浏览器不给 `disabled` 的表单控件派发鼠标/指针事件 ⇒ 提示监听器
// 若挂在按钮本身，禁用态的提示**永远不出现**，而那正是最需要它的时刻（未接入语音会话
// 时那颗按钮就是禁用的）。迁移前的 `Tooltip.tsx` 把监听器挂在外层 `.tt-anchor` span 上，
// 所以那时是能弹的 ⇒ 迁移后必须把锚点留在 span 上。
//
// ⚠️ jsdom **复现不了**那条浏览器行为（它会照常把事件派给 disabled 元素），所以这里钉的是
// **结构**：带 Radix 触发器标记（`data-state`）的元素必须是那个外层 span，而不是按钮本身。
// 这条能挡住的就是「把 span 去掉、直接 let 按钮当锚点」这个回退。
it("禁用态的语音入口把提示锚点留在外层 span 上（不是按钮本身）", async () => {
  // 刻意**不传** onCreateVoiceSession ⇒ 按钮 disabled —— 用例测的就是禁用态。
  await act(async () => root.render(<AppRail />));

  const voice = container.querySelector<HTMLButtonElement>(
    'button[aria-label="navRail.newVoiceSession"]',
  );
  expect(voice).not.toBeNull();
  // 前置条件：它真的禁用了。否则这条用例在测另一个状态、而且会因锚点不同而误红。
  expect(voice!.disabled).toBe(true);

  const anchor = voice!.parentElement;
  expect(anchor?.tagName).toBe("SPAN");
  // Radix 把触发器属性（含 data-state）落在锚点上 ⇒ 顺带证明 span 才是触发元素。
  expect(anchor?.getAttribute("data-state")).not.toBeNull();
});
