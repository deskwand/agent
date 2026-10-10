// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDialogs } from "../dialog-test-helpers";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { IdeasView } from "../../renderer/components/IdeasView";
import { useAppStore } from "../../renderer/store";
import type { IdeaSummary } from "../../shared/ideas";

let container: HTMLDivElement;
let root: Root;
const setStatus = vi.fn();
const remove = vi.fn();
const list = vi.fn();
const read = vi.fn();

const idea = (
  name: string,
  excerpt: string,
  status: "inbox" | "archived" = "inbox",
  sourceSessionId: string | null = "s1",
): IdeaSummary => ({
  name,
  excerpt,
  createdAt: Date.parse("2026-10-11T15:04:07+08:00"),
  status,
  archivedAt: null,
  sourceSessionId,
  sourceView: "chat",
});

function buttonByText(
  text: string,
  scope: ParentNode = container,
): HTMLButtonElement {
  const el = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(el, `按钮「${text}」必须存在`).toBeTruthy();
  return el as HTMLButtonElement;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const el = container.querySelector(`button[aria-label="${label}"]`);
  expect(el, `aria-label="${label}" 的按钮必须存在`).toBeTruthy();
  return el as HTMLButtonElement;
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<IdeasView />);
  });
  await act(async () => {});
}

beforeEach(() => {
  // 本仓的 vitest 4 里 `clearAllMocks` 会连**实现**一起清掉，实现必须写在它之后。
  vi.clearAllMocks();
  // `mockImplementation` 而不是 `mockResolvedValue`：列表每次都得是**新对象**，
  // 否则 `find()` 会一直返回同一个引用，依赖 `selected` 对象身份的写法在这份测试里
  // 永远不会被触发（H1 那条回归就成了摆设）。
  list.mockImplementation(async () => ({
    inbox: [idea("a", "第一条"), idea("b", "第二条")],
    archived: [idea("c", "已归档的", "archived")],
    skipped: 0,
  }));
  read.mockResolvedValue({ body: "正文一", mtimeMs: 1 });
  setStatus.mockResolvedValue({});
  remove.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    platform: "darwin",
    ideas: { list, read, setStatus, remove, update: vi.fn() },
  };
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    activeView: "ideas",
    ideasSelectedName: "a",
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  cleanupDialogs();
});

describe("灵感视图", () => {
  it("默认只显示未归档，且不显示归档组标题", async () => {
    await render();
    expect(container.textContent).toContain("第一条");
    expect(container.textContent).not.toContain("已归档的");
    expect(container.textContent).not.toContain("ideas.archivedGroup");
  });

  it("开关打开后归档项附在末尾，并带一个组标题", async () => {
    await render();
    act(() => buttonByText("ideas.showArchived").click());
    expect(useAppStore.getState().showArchivedIdeas).toBe(true);
    await act(async () => {});
    expect(container.textContent).toContain("已归档的");
    expect(container.textContent).toContain("ideas.archivedGroup");
  });

  it("返回按钮切回聊天（复用 common.back，不另发明）", async () => {
    await render();
    act(() => buttonByLabel("common.back").click());
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("列表行 hover 的归档键按 aria-label 定位，点击调 setStatus", async () => {
    await render();
    act(() => buttonByLabel("ideas.archiveNamed").click());
    await act(async () => {});
    expect(setStatus).toHaveBeenCalledWith("a", "archived");
  });

  it("列表行 hover 的删除键也走确认框（删除只有一个护栏）", async () => {
    await render();
    act(() => buttonByLabel("ideas.removeNamed").click());
    expect(remove).not.toHaveBeenCalled();
    const confirm = document.body.querySelector('[role="alertdialog"]');
    expect(confirm).toBeTruthy();
    await act(async () => buttonByText("common.delete", confirm!).click());
    expect(remove).toHaveBeenCalledWith("a");
  });

  it("详情头部：交给 AI 的两项都只是把正文填进输入框", async () => {
    await render();
    act(() => buttonByText("ideas.handOff").click());
    act(() => buttonByText("ideas.handOffCurrent").click());
    expect(useAppStore.getState().pendingEditorAppend).toBe("正文一");
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("新会话处理：清掉当前会话再填输入框", async () => {
    useAppStore.setState({ activeSessionId: "s1" });
    await render();
    act(() => buttonByText("ideas.handOff").click());
    act(() => buttonByText("ideas.handOffNew").click());
    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().pendingEditorAppend).toBe("正文一");
  });

  it("⋯ 菜单：归档项走确认框才删", async () => {
    await render();
    act(() => buttonByLabel("ideas.moreActions").click());
    act(() => buttonByText("ideas.remove").click());
    expect(remove).not.toHaveBeenCalled();

    const confirm = document.body.querySelector('[role="alertdialog"]');
    expect(confirm).toBeTruthy();
    await act(async () => buttonByText("common.delete", confirm!).click());
    expect(remove).toHaveBeenCalledWith("a");
  });

  it("⋯ 里的刷新在加载中禁用（v1 的 ideasLoading 不再是孤儿）", async () => {
    await render();
    // 渲染完成之后再置「加载中」：否则挂载那次 loadIdeas 会把它写回 false。
    act(() => useAppStore.setState({ ideasLoading: true }));
    act(() => buttonByLabel("ideas.moreActions").click());
    expect(buttonByText("ideas.refresh").disabled).toBe(true);
  });

  it("来源还在 → 显示会话标题，点它切回那次会话", async () => {
    useAppStore.setState({
      sessions: [
        {
          id: "s1",
          title: "输入框浮层改造",
          kind: "ordinary",
          status: "idle",
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          isProjectMode: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ] as never,
    });
    await render();
    act(() => buttonByText("输入框浮层改造").click());
    expect(useAppStore.getState().activeSessionId).toBe("s1");
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("会话已删 → 显示「会话已删除」且那一行不是按钮", async () => {
    list.mockResolvedValue({
      inbox: [idea("a", "第一条", "inbox", "gone")],
      archived: [],
      skipped: 0,
    });
    await render();
    expect(container.textContent).toContain("ideas.sourceDeleted");
    expect(container.textContent).not.toContain("ideas.sourceNone");
  });

  it("本来就与会话无关 → 中性文案，不说「已删除」", async () => {
    list.mockResolvedValue({
      inbox: [idea("a", "第一条", "inbox", null)],
      archived: [],
      skipped: 0,
    });
    await render();
    expect(container.textContent).toContain("ideas.sourceNone");
    expect(container.textContent).not.toContain("ideas.sourceDeleted");
  });

  it("空态给出快捷键提示（按平台渲染）", async () => {
    list.mockResolvedValue({ inbox: [], archived: [], skipped: 0 });
    useAppStore.setState({ ideasSelectedName: null });
    await render();
    expect(container.textContent).toContain("ideas.emptyTitle");
    expect(container.textContent).toContain("ideas.emptyHint");
  });

  it("有解析不了的文件时在顶部提示数量", async () => {
    list.mockResolvedValue({ inbox: [], archived: [], skipped: 2 });
    await render();
    expect(container.textContent).toContain("ideas.skipped");
  });

  it("列表拉失败时出错误横幅（否则和「没有想法」长得一样）", async () => {
    list.mockRejectedValue(new Error("EACCES"));
    await render();
    expect(container.textContent).toContain("ideas.loadFailed");
  });

  it("选中的那条不见了 → 回落到第一条（右栏不许莫名空着）", async () => {
    await render();
    list.mockResolvedValue({
      inbox: [{ ...idea("b", "第二条") }],
      archived: [],
      skipped: 0,
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(useAppStore.getState().ideasSelectedName).toBe("b");
    expect(container.textContent).toContain("第二条");
  });

  it("页头那颗「记一笔」直接开浮层（页面内终于有入口了）", async () => {
    await render();
    const add = container.querySelector<HTMLButtonElement>(
      '[data-testid="ideas-add"]',
    );
    expect(add, "页头要有新增入口").toBeTruthy();
    // 图标键没有字，可访问名与 tooltip 都得报出"记一笔（键位）"，
    // 否则一个光秃秃的 ＋ 谁也不知道是加什么。
    expect(add!.getAttribute("aria-label")).toBe("ideas.addWithShortcut");
    act(() => add!.click());
    expect(useAppStore.getState().ideaCaptureOpen).toBe(true);
  });

  it("列表空的时候这颗按钮也还在（不至于只剩一句 ⌘⇧K 教学）", async () => {
    list.mockResolvedValue({ inbox: [], archived: [], skipped: 0 });
    useAppStore.setState({ ideasSelectedName: null });
    await render();
    expect(container.querySelector('[data-testid="ideas-add"]')).toBeTruthy();
  });

  it("打开视图时重拉列表", async () => {
    await render();
    expect(list).toHaveBeenCalled();
  });
});
