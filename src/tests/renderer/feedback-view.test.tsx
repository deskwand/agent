// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDialogs } from "../dialog-test-helpers";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "zh" },
  }),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  reply: vi.fn(),
  remove: vi.fn(),
  removeReply: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("../../renderer/services/feedback-api", () => ({
  FeedbackApiError: class FeedbackApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  feedbackApi: api,
}));

import { FeedbackView } from "../../renderer/components/feedback/FeedbackView";
import { FeedbackApiError } from "../../renderer/services/feedback-api";
import { useAppStore } from "../../renderer/store";
import type {
  FeedbackIssueDetail,
  FeedbackIssueSummary,
  FeedbackViewer,
} from "../../shared/feedback";

const viewer: FeedbackViewer = { isLoggedIn: true, isAdmin: false };

const issue = (
  overrides: Partial<FeedbackIssueSummary> = {},
): FeedbackIssueSummary => ({
  id: "i1",
  type: "bug",
  title: "切换主题后侧栏闪烁",
  status: "open",
  author: { handle: "a1b2c3", isAdmin: false, isMe: true },
  appVersion: "1.0.52",
  platform: "darwin",
  replyCount: 2,
  createdAt: "2026-10-22T09:00:00Z",
  ...overrides,
});

const detail = (
  overrides: Partial<FeedbackIssueDetail> = {},
): FeedbackIssueDetail => ({
  ...issue(),
  body: "完整正文",
  replies: [],
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    cloudConfig: {
      serverUrl: "https://api.deskwand.com",
      token: "token-1",
      isLoggedIn: true,
      email: "user@example.com",
      level: "default",
      balanceMicroUsd: 0,
    },
  });
  (window as any).electronAPI = {
    getVersion: vi.fn(async () => "1.0.52"),
    platform: "darwin",
  };
  for (const fn of Object.values(api)) fn.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  cleanupDialogs();
  container.remove();
  delete (window as any).electronAPI;
});

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<FeedbackView />);
  });
  await vi.waitFor(() => expect(api.list).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

describe("FeedbackView list", () => {
  it("renders the public list for a logged-out user", async () => {
    useAppStore.setState({ cloudConfig: null });
    api.list.mockResolvedValue({
      issues: [
        issue({ author: { handle: "a1b2c3", isAdmin: false, isMe: false } }),
      ],
      total: 1,
      viewer: { isLoggedIn: false, isAdmin: false },
    });
    api.get.mockResolvedValue({
      issue: detail(),
      viewer: { isLoggedIn: false, isAdmin: false },
    });

    await mount();

    await vi.waitFor(() =>
      expect(container.textContent).toContain("切换主题后侧栏闪烁"),
    );
    expect(container.textContent).toContain("feedback.author.handle");
    expect(container.textContent).toContain("a1b2c3");
  });

  it("filters by status and shows the empty state", async () => {
    api.list
      .mockResolvedValueOnce({ issues: [issue()], total: 1, viewer })
      .mockResolvedValueOnce({ issues: [], total: 0, viewer });
    api.get.mockResolvedValue({ issue: detail(), viewer });

    await mount();
    const resolved = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.status.resolved"),
    );
    expect(resolved).toBeTruthy();

    await act(async () => {
      resolved!.click();
    });
    await vi.waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        status: "resolved",
        limit: 20,
        offset: 0,
      }),
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("feedback.empty"),
    );
  });
});

describe("FeedbackView detail", () => {
  it("renders the body and replies, with the maintainer badge only on replies", async () => {
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({
      issue: detail({
        replies: [
          {
            id: "r1",
            body: "已经复现，正在修。",
            author: { handle: "ffee01", isAdmin: true, isMe: false },
            createdAt: "2026-10-22T09:10:00Z",
          },
        ],
      }),
      viewer,
    });

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));
    expect(container.textContent).toContain("已经复现，正在修。");
    expect(container.textContent).toContain("feedback.author.maintainer");
    const byline = container.querySelector('[data-testid="feedback-byline"]');
    expect(byline?.textContent).not.toContain("feedback.author.maintainer");
    const reply = container.querySelector('[data-testid="feedback-reply"]');
    expect(reply?.textContent).toContain("feedback.author.maintainer");
  });

  it("renders untrusted content as text, not HTML", async () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({
      issue: detail({ body: payload, replies: [] }),
      viewer,
    });

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(payload));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("shows a login CTA when logged out and opens the login modal", async () => {
    useAppStore.setState({ cloudConfig: null });
    api.list.mockResolvedValue({
      issues: [issue()],
      total: 1,
      viewer: { isLoggedIn: false, isAdmin: false },
    });
    api.get.mockResolvedValue({
      issue: detail(),
      viewer: { isLoggedIn: false, isAdmin: false },
    });

    await mount();
    const login = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.login"),
    );
    expect(login).toBeTruthy();

    await act(async () => {
      login!.click();
    });
    expect(useAppStore.getState().showLoginModal).toBe(true);
  });

  it("posts a reply and updates the list count", async () => {
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({ issue: detail(), viewer });
    api.reply.mockResolvedValue({
      reply: {
        id: "r1",
        body: "收到",
        author: { handle: "a1b2c3", isAdmin: false, isMe: true },
        createdAt: "2026-10-22T09:10:00Z",
      },
    });

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "收到");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.reply"),
    );
    await act(async () => {
      send!.click();
    });

    await vi.waitFor(() =>
      expect(api.reply).toHaveBeenCalledWith("i1", "收到"),
    );
    expect(container.textContent).toContain("收到");
    expect(container.textContent).toContain("feedback.replies");
  });

  it("keeps the reply draft when the request fails", async () => {
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({ issue: detail(), viewer });
    api.reply.mockRejectedValue(new FeedbackApiError("RATE_LIMITED", "", 429));

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));
    const textarea = container.querySelector("textarea")!;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "草稿");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.reply"),
    );
    await act(async () => {
      send!.click();
    });

    await vi.waitFor(() =>
      expect(api.reply).toHaveBeenCalledWith("i1", "草稿"),
    );
    expect(textarea.value).toBe("草稿");
  });

  it("clears the session and opens login on 401", async () => {
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({ issue: detail(), viewer });
    api.reply.mockRejectedValue(new FeedbackApiError("UNAUTHORIZED", "", 401));

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "401");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.reply"),
    );
    await act(async () => {
      send!.click();
    });

    await vi.waitFor(() => expect(api.reply).toHaveBeenCalled());
    expect(useAppStore.getState().cloudConfig).toBeNull();
    expect(useAppStore.getState().showLoginModal).toBe(true);
  });

  it("shows a forbidden notice for 403", async () => {
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({ issue: detail(), viewer });
    api.reply.mockRejectedValue(
      new FeedbackApiError("NOT_ALLOWLISTED", "", 403),
    );

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "403");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.reply"),
    );
    await act(async () => {
      send!.click();
    });

    await vi.waitFor(() => expect(api.reply).toHaveBeenCalled());
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "feedback.error.forbidden",
    );
  });
});

describe("FeedbackView compose", () => {
  it("opens login instead of the compose dialog when logged out", async () => {
    useAppStore.setState({ cloudConfig: null });
    api.list.mockResolvedValue({
      issues: [],
      total: 0,
      viewer: { isLoggedIn: false, isAdmin: false },
    });

    await mount();
    const newButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.new"),
    );
    await act(async () => {
      newButton!.click();
    });
    expect(useAppStore.getState().showLoginModal).toBe(true);
    expect(document.body.textContent).not.toContain("feedback.compose.title");
  });

  it("creates an issue and selects it", async () => {
    api.list
      .mockResolvedValueOnce({ issues: [], total: 0, viewer })
      .mockResolvedValueOnce({ issues: [issue()], total: 1, viewer });
    api.create.mockResolvedValue({ issue: issue() });
    api.get.mockResolvedValue({ issue: detail(), viewer });

    await mount();
    const newButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.new"),
    );
    await act(async () => {
      newButton!.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const title = dialog?.querySelector<HTMLInputElement>("input");
    const body = dialog?.querySelector<HTMLTextAreaElement>("textarea");
    expect(title).toBeTruthy();
    expect(body).toBeTruthy();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(title, "新问题");
      title!.dispatchEvent(new Event("input", { bubbles: true }));
      const setBody = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setBody?.call(body, "正文");
      body!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("feedback.compose.submit"),
    );
    await act(async () => {
      submit!.click();
    });

    await vi.waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        type: "bug",
        title: "新问题",
        body: "正文",
        appVersion: "1.0.52",
        platform: "darwin",
      }),
    );
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "feedback.notice.created",
    );
  });

  it("disables submit when the title exceeds 120 code points", async () => {
    api.list.mockResolvedValue({ issues: [], total: 0, viewer });

    await mount();
    const newButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.new"),
    );
    await act(async () => {
      newButton!.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    const title = dialog?.querySelector<HTMLInputElement>("input");
    const body = dialog?.querySelector<HTMLTextAreaElement>("textarea");

    await act(async () => {
      const setTitle = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setTitle?.call(title, "😀".repeat(121));
      title!.dispatchEvent(new Event("input", { bubbles: true }));
      const setBody = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setBody?.call(body, "正文");
      body!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("feedback.compose.submit"),
    );
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the compose draft when the request fails", async () => {
    api.list.mockResolvedValue({ issues: [], total: 0, viewer });
    api.create.mockRejectedValue(new FeedbackApiError("RATE_LIMITED", "", 429));

    await mount();
    const newButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.new"),
    );
    await act(async () => {
      newButton!.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    const title = dialog?.querySelector<HTMLInputElement>("input");
    const body = dialog?.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const setTitle = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setTitle?.call(title, "保留的标题");
      title!.dispatchEvent(new Event("input", { bubbles: true }));
      const setBody = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setBody?.call(body, "正文");
      body!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("feedback.compose.submit"),
    );
    await act(async () => {
      submit!.click();
    });

    await vi.waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(title!.value).toBe("保留的标题");
  });
});

describe("FeedbackView actions", () => {
  it("deletes an issue after confirmation and selects the next one", async () => {
    const second = issue({ id: "i2", title: "第二条" });
    api.list.mockResolvedValue({ issues: [issue(), second], total: 2, viewer });
    api.get.mockImplementation(async (id: string) =>
      id === "i2"
        ? {
            issue: detail({
              id: "i2",
              title: "第二条",
              body: "第二条正文",
              replies: [],
            }),
            viewer,
          }
        : { issue: detail(), viewer },
    );
    api.remove.mockResolvedValue(undefined);

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));

    const more = container.querySelector(
      'button[aria-label="feedback.more"]',
    ) as HTMLButtonElement;
    await act(async () => {
      more.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    const deleteItem = [
      ...document.body.querySelectorAll('[role="menuitem"]'),
    ].find((item) => item.textContent?.includes("feedback.delete.action"));
    await act(async () => {
      (deleteItem as HTMLElement).click();
    });
    const confirm = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("feedback.delete.confirm"),
    );
    await act(async () => {
      confirm!.click();
    });

    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledWith("i1"));
    await vi.waitFor(() => expect(container.textContent).toContain("第二条"));
    expect(container.textContent).not.toContain("切换主题后侧栏闪烁");
  });

  it("resolves an issue and removes it from the open filter", async () => {
    const otherAuthor = { handle: "a1b2c3", isAdmin: false, isMe: false };
    const first = issue({ author: otherAuthor });
    const second = issue({ id: "i2", title: "第二条", author: otherAuthor });
    const adminViewer = { isLoggedIn: true, isAdmin: true };
    useAppStore.setState({
      cloudConfig: {
        serverUrl: "https://api.deskwand.com",
        token: "admin-token",
        isLoggedIn: true,
        email: "admin@deskwand.com",
        level: "default",
        balanceMicroUsd: 0,
      },
    });
    api.list.mockResolvedValue({
      issues: [first, second],
      total: 2,
      viewer: adminViewer,
    });
    api.get.mockImplementation(async (id: string) =>
      id === "i2"
        ? {
            issue: detail({
              ...second,
              body: "第二条正文",
              replies: [],
            }),
            viewer: adminViewer,
          }
        : { issue: detail({ author: otherAuthor }), viewer: adminViewer },
    );
    api.setStatus.mockResolvedValue({ status: "resolved" });

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));
    expect(
      container.querySelector('button[aria-label="feedback.more"]'),
    ).toBeTruthy();

    const openFilter = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("feedback.status.open"),
    );
    await act(async () => {
      openFilter!.click();
    });
    await vi.waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        status: "open",
        limit: 20,
        offset: 0,
      }),
    );

    const resolve = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.resolve"),
    );
    await act(async () => {
      resolve!.click();
    });

    await vi.waitFor(() =>
      expect(api.setStatus).toHaveBeenCalledWith("i1", "resolved"),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("第二条"));
    expect(container.textContent).not.toContain("切换主题后侧栏闪烁");
  });
});

describe("FeedbackView list edges", () => {
  it("does not duplicate rows when load more overlaps", async () => {
    api.list
      .mockResolvedValueOnce({ issues: [issue()], total: 2, viewer })
      .mockResolvedValueOnce({
        issues: [issue(), issue({ id: "i2", title: "第二条" })],
        total: 2,
        viewer,
      });
    api.get.mockImplementation(async (id: string) =>
      id === "i2"
        ? {
            issue: detail({
              id: "i2",
              title: "第二条",
              body: "第二条正文",
              replies: [],
            }),
            viewer,
          }
        : { issue: detail(), viewer },
    );

    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain("切换主题后侧栏闪烁"),
    );
    const loadMore = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.loadMore"),
    );
    await act(async () => {
      loadMore!.click();
    });
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    const rows = [...container.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("切换主题后侧栏闪烁"),
    );
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain("第二条");
    expect(container.querySelector("h1")?.textContent).toBe(
      "切换主题后侧栏闪烁",
    );
  });

  it("keeps the selected issue when refresh returns a different first page", async () => {
    api.list
      .mockResolvedValueOnce({
        issues: [issue({ id: "i2", title: "第二条" })],
        total: 2,
        viewer,
      })
      .mockResolvedValueOnce({ issues: [issue()], total: 2, viewer });
    api.get.mockImplementation(async (id: string) =>
      id === "i2"
        ? {
            issue: detail({
              id: "i2",
              title: "第二条",
              body: "第二条正文",
              replies: [],
            }),
            viewer,
          }
        : { issue: detail(), viewer },
    );

    await mount();
    await vi.waitFor(() =>
      expect(container.querySelector("h1")?.textContent).toBe("第二条"),
    );
    const refresh = container.querySelector(
      'button[aria-label="feedback.refresh"]',
    ) as HTMLButtonElement;
    await act(async () => {
      refresh.click();
    });
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(container.querySelector("h1")?.textContent).toBe("第二条");
  });

  it("clears the detail and notices when the issue was deleted elsewhere", async () => {
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockRejectedValue(new FeedbackApiError("NOT_FOUND", "", 404));

    await mount();
    await vi.waitFor(() =>
      expect(useAppStore.getState().globalNotice?.messageKey).toBe(
        "feedback.error.deleted",
      ),
    );
    expect(container.textContent).toContain("feedback.detail.select");
    expect(useAppStore.getState().globalNotice?.messageKey).not.toBe(
      "feedback.error.generic",
    );
  });

  it("shows a generic notice on a network error", async () => {
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({ issue: detail(), viewer });
    api.reply.mockRejectedValue(new FeedbackApiError("NETWORK", "", 0));

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("完整正文"));
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "network");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("feedback.reply"),
    );
    await act(async () => {
      send!.click();
    });

    await vi.waitFor(() => expect(api.reply).toHaveBeenCalled());
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "feedback.error.generic",
    );
  });
});

describe("FeedbackView header", () => {
  it("returns to chat from the page header", async () => {
    useAppStore.setState({ activeView: "feedback" });
    api.list.mockResolvedValue({ issues: [issue()], total: 1, viewer });
    api.get.mockResolvedValue({ issue: detail(), viewer });

    await mount();
    const back = container.querySelector('button[aria-label="common.back"]');
    expect(back).toBeTruthy();

    await act(async () => {
      (back as HTMLButtonElement).click();
    });
    expect(useAppStore.getState().activeView).toBe("chat");
  });
});
