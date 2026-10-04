// @vitest-environment jsdom
//
// 图标栏语音入口的字形归属：它必须是自己的字形，不能和输入框的听写麦克风同形。
// 这里挂真实 AppRail（含底部 HelpMenu / AccountCluster），并把负断言锁在栏内
// （nav[aria-label="navRail.label"]）—— 两个正断言先证明底部簇已挂载，否则
// 那条「栏内没有 svg.lucide-mic」会在「底部根本没渲染」时假通过。
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Mic } from "lucide-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppRail } from "../../renderer/components/AppRail";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
// 只简化提示气泡本身：它不影响字形，也不影响按钮是否挂载。
vi.mock("../../renderer/components/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
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
