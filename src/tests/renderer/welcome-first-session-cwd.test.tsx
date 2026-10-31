// @vitest-environment jsdom
//
// 这条测试钉的是整条链的**尾端**：「灵感交给 AI → 选中项目」之后，用户真的发送时
// 新会话的 cwd 必须还是那个项目。
//   IdeasView.handOffInProject → store.workingDir = 项目路径
//   → WelcomeView.handleSubmit → startSession(title, blocks, workingDir)
// 前两跳在 ideas-view.test.tsx 里断言过 store 的那对值；这里补最后一跳。
// 没有它，`workingDir → session.start.payload.cwd` 全程无人观测 —— 而这条链一旦
// 断掉，表现是静默落回默认目录、没有任何报错。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const startSession = vi.fn();
vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ startSession, isElectron: false }),
}));

import { WelcomeView } from "../../renderer/components/WelcomeView";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  startSession.mockResolvedValue(null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    workingDir: "/work/alpha",
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function submitFirstMessage(text: string): Promise<void> {
  await act(async () => {
    root.render(<WelcomeView />);
  });
  const editor = container.querySelector<HTMLElement>("[data-placeholder]")!;
  await act(async () => {
    editor.textContent = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

describe("欢迎页把 workingDir 当作新会话的 cwd", () => {
  it("发送第一条消息时，cwd 就是 store 里的项目路径", async () => {
    await submitFirstMessage("把这个做成一个能跑的东西");

    expect(startSession).toHaveBeenCalledTimes(1);
    // startSession(title, content, cwd, ...) —— 第三个参数
    expect(startSession.mock.calls[0][2]).toBe("/work/alpha");
  });

  it("没有工作目录时传 undefined（沿用主进程默认目录）", async () => {
    useAppStore.setState({ workingDir: null });

    await submitFirstMessage("随便聊两句");

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession.mock.calls[0][2]).toBeUndefined();
  });

  it("项目名不再进标题；落点由底栏 chip 交代（只交代一次）", async () => {
    await submitFirstMessage("把这个做成一个能跑的东西");

    // 标题回到不带项目名那一支（i18n 在测试里被 mock 成返回 key）
    expect(container.textContent).toContain("welcome.title");
    // 「用户看得见落地在哪」这个诉求没丢：它现在只由底栏的项目 chip 承担
    const chip = container.querySelector<HTMLElement>(
      'button[aria-label="welcome.projectMenu.triggerLabel"]',
    );
    expect(chip?.textContent).toContain("alpha");
  });
});
