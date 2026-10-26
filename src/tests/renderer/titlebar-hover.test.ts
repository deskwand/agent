// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Titlebar } from "../../renderer/components/Titlebar";
import { useAppStore } from "../../renderer/store";
import { resetIsGitRepoCacheForTests } from "../../renderer/hooks/use-is-git-repo";

// 用真实挂载而不是 renderToStaticMarkup：zustand v5 的 useSyncExternalStore 在
// SSR 下用的是 getInitialState() 作为 server snapshot，setState 对 SSR 结果无效，
// 而本测试需要设置 activeSessionId / isArtifactPanelOpen 才能覆盖到对应分支。
let container: HTMLDivElement;
let root: Root;

async function mountTitlebar(): Promise<HTMLDivElement> {
  await act(async () => {
    root.render(React.createElement(Titlebar));
  });
  return container;
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
  // 探测结果在模块级缓存里（同 cwd 10s），不乱清会让下一个用例拿到上一个的结论
  resetIsGitRepoCacheForTests();
  window.electronAPI = {
    window: { onFullScreenChanged: () => () => {} },
    git: {
      hasChanges: async () => ({ isRepo: true, changeCount: 1 }),
    },
  } as unknown as typeof window.electronAPI;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("标题栏操作按钮", () => {
  beforeEach(() => {
    // showSessionHeader = Boolean(activeSessionId) && !showSettings
    // 代码审查那档还需要「活动会话有 cwd」且该 cwd 是 git 仓库（见 hasChanges stub）
    useAppStore.setState({
      activeSessionId: "s1",
      sessions: [
        {
          id: "s1",
          title: "s1",
          status: "idle",
          cwd: "/repo-titlebar-hover",
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          isProjectMode: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
  });

  it("整个标题栏不输出任何原生 title 属性", async () => {
    const el = await mountTitlebar();
    const titled = [...el.querySelectorAll("[title]")].map((n) => n.tagName);
    expect(titled).toEqual([]);
  });

  it("5 个操作按钮都有 aria-label", async () => {
    const el = await mountTitlebar();
    // 代码审查那颗要等 git 探针落地才渲染（前提由本文件的两个 beforeEach 给齐）
    await act(async () => {
      await Promise.resolve();
    });
    // store 初始值下的实际文案 key：
    //   sidebarCollapsed=false    → context.collapsePanel（左簇开合按钮）
    //   rightPanelMode=null       → titlebar.fileBrowser / titlebar.builtInBrowser
    //   rightPanelMode!=="review" → reviewPanel.title
    //   isArtifactPanelOpen=false → artifactPanel.toggle
    // 折叠态的 ✎（sidebar.newChat）由 titlebar-left-cluster.test.ts 覆盖
    for (const key of [
      "artifactPanel.toggle",
      "titlebar.fileBrowser",
      "titlebar.builtInBrowser",
      "reviewPanel.title",
      "context.collapsePanel",
    ]) {
      expect(el.querySelector(`[aria-label="${key}"]`), key).not.toBeNull();
    }
  });

  it("每个按钮都是 Tooltip 的触发器（没有漏包的）", async () => {
    // ⚠️ 2026-10-09：这条原先断言「`b.closest(".tt-anchor")` 非空」✓ —— 而 `.tt-anchor`
    // 是**老组件**给子元素套的那层 `<span>` ✗（`Tooltip.tsx` 的 `tt-anchor` 类 ✓），
    // 迁到 shadcn 的 `TooltipTrigger asChild` 后**那一层没有了** ✗✓。
    // **意图一字未变** ✓（「每个按钮都被 Tooltip 包住、没有漏包的」✓），换成**新的代理** ✗✓：
    // Radix 的 `TooltipTrigger` 会在**触发器元素本身**写 `data-state`（"closed" / "delayed-open" ✓）——
    // 这比 `.tt-anchor` **更强** ✓，因为它证明的是「这个按钮**已注册为触发器**」✓✓，而不只是被套了一层。
    const el = await mountTitlebar();
    const buttons = [...el.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(
        b.getAttribute("data-state"),
        b.textContent || b.tagName,
      ).not.toBeNull();
      // ⚠️ 2026-10-09（审查员 M1 ✓）：这里原先还有一条 `aria-describedby ?? closest("[data-state]")`
      // 的断言 —— 但 `closest` **会匹配元素自身** ✗ ⇒ 上面那条过了它就必然过，**恒真** ✗✓。
      // 删掉它 ✓：上面那条 `data-state` 才是真正在测「已注册为触发器」✓（判据强度未降 ✓）。
    }
    // 气泡是 hover 时按需挂到 body 的，初始 DOM 里不该有
    expect(el.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("未开启的按钮用 hover 叠层，开启的按钮用 on 叠层", async () => {
    const el = await mountTitlebar();
    const browser = el.querySelector<HTMLElement>(
      '[aria-label="titlebar.builtInBrowser"]',
    )!;
    // 2026-10：叠层 token 换成官方 --accent（悬浮底 = hover:bg-accent）。
    // 注意 "hover:bg-accent" 里含子串 "bg-accent"，所以不能再拿 includes 判"没有 bg-accent" ——
    // 必须按 token 边界判"没有裸的 bg-accent"。
    expect(browser.className).toContain("hover:bg-hover-surface");
    expect(browser.className).not.toMatch(
      /(?:^|\s)bg-selected-surface(?:\s|$)/,
    );
  });

  it("面板开启时该按钮切到 on 叠层", async () => {
    useAppStore.setState({ isArtifactPanelOpen: true });
    const el = await mountTitlebar();
    const artifact = el.querySelector<HTMLElement>(
      '[aria-label="artifactPanel.toggle"]',
    )!;
    expect(artifact.className).toMatch(/(?:^|\s)bg-selected-surface(?:\s|$)/);
    // 开态不再要求"没有 hover:bg-accent"：app-button 的 ghost 变体自带 hover:bg-accent，
    // 而开态用的是裸 bg-accent（更高一档的实心底）—— 两者共存是预期。
  });
});
