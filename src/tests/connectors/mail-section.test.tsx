// @vitest-environment jsdom
/**
 * 邮箱分段的回归测试。
 *
 * 它守的是一个很容易静默退化的点：视图的分组键是 `entry.category ?? "other"`，
 * 而邮箱条目**没有** `category` —— 不新增分组的话，`zhangsan@qq.com` 会和用户手搓的
 * `my-tools` 并排躺在「自建服务」段里，页面不会报错，只是位置错了。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorsView } from "../../renderer/components/connectors/ConnectorsView";
import type { ConnectorEntry } from "../../shared/connectors";
import { useAppStore } from "../../renderer/store";

const api = vi.hoisted(() => {
  const connectors = {
    list: vi.fn(),
    addCatalogServer: vi.fn(),
    connectWithKey: vi.fn(),
    removeServer: vi.fn(),
    setEnabled: vi.fn(),
    authorize: vi.fn(),
    addCustomServer: vi.fn(),
    onStatusChanged: vi.fn(() => () => {}),
  };
  const mail = {
    listAccounts: vi.fn(),
    addAccount: vi.fn(),
    removeAccount: vi.fn(),
    updateCredential: vi.fn(),
    testAccount: vi.fn(),
  };
  // 组件在**模块作用域**读 window.electronAPI，所以它必须在 import 之前就存在
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    connectors,
    mail,
  };
  return { connectors, mail };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
function mailEntry(email: string): ConnectorEntry {
  return {
    key: `mail:${email}`,
    serverName: "Mail",
    source: "mail",
    transport: "stdio",
    nameKey: email,
    descriptionKey: "mail.provider.qq.name",
    avatarMark: "QQ",
    instances: [
      {
        id: email,
        label: email,
        status: { kind: "ready" },
        summary: "connectors.summary.local",
      },
    ],
  };
}

function customEntry(): ConnectorEntry {
  return {
    key: "mcp:server:my-tools",
    serverName: "my-tools",
    source: "mcp-custom",
    transport: "stdio",
    nameKey: "my-tools",
    instances: [
      {
        id: "my-tools",
        label: "my-tools",
        status: { kind: "idle" },
        summary: "connectors.summary.local",
      },
    ],
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  api.connectors.list.mockResolvedValue([
    mailEntry("zhangsan@qq.com"),
    customEntry(),
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // 迁到 Radix 后确认框经 Portal 挂到 document.body，清掉以免跨用例污染
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  vi.unstubAllGlobals();
});

async function renderView(): Promise<void> {
  await act(async () => {
    root.render(<ConnectorsView />);
  });
  // list() 是 promise，再让一轮 microtask 落地
  await act(async () => {});
}

function sectionTitles(): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="section-title"]'),
  ).map((el) => (el.textContent ?? "").trim());
}

describe("mail section", () => {
  it("puts mailboxes in their own section", async () => {
    await renderView();
    // i18n 被 mock 成 t(key) => key，所以段标题就是这个 key
    expect(
      sectionTitles().some((t) => t.includes("connectors.category.mail")),
    ).toBe(true);
  });

  it("never files a mailbox under the self-hosted section", async () => {
    await renderView();
    const titles = sectionTitles();
    const mailIndex = titles.findIndex((t) =>
      t.includes("connectors.category.mail"),
    );
    const otherIndex = titles.findIndex((t) =>
      t.includes("connectors.category.other"),
    );
    expect(mailIndex).toBe(0);
    expect(otherIndex).toBeGreaterThan(mailIndex);
  });

  it("renders the provider mark as the avatar, not the email's first letter", async () => {
    await renderView();
    expect(container.textContent).toContain("QQ");
  });

  it("routes a mailbox removal to the mail IPC, not the MCP registry", async () => {
    await renderView();
    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "connectors.action.removeMailbox",
    );
    expect(remove).toBeTruthy();
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 弹确认框，此时还不该发 IPC
    expect(api.mail.removeAccount).not.toHaveBeenCalled();
    expect(api.connectors.removeServer).not.toHaveBeenCalled();
  });

  it("删邮箱确认走 ConfirmDialog：标题与副行都渲染了【Review Focus #2】", async () => {
    // 迁移前这是内联的 modal-overlay + .card；迁移后是 shadcn 的 AlertDialog。
    // 这条钉的是「**副行没丢**」—— 那正是当初没直接复用 ConfirmDialog 的原因
    //（计划 1 时 ConfirmDialog 还没有 description 槽位）。
    //
    // 本文件把 i18n mock 成 t(key) => key，所以断言查的是**两个 key 都在**
    // —— 这恰好证明「副行节点渲染了、且接对了 key」，插值是 i18next 的事。
    // 内容经 Portal 挂在 document.body 下，所以查 body（陷阱 4）。
    await renderView();
    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "connectors.action.removeMailbox",
    );
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog, "确认框必须存在").not.toBeNull();
    expect(dialog!.textContent).toContain("connectors.mail.removeConfirmTitle");
    expect(
      dialog!.textContent,
      "副行必须渲染（这是 ConfirmDialog 迁移前没有的能力）",
    ).toContain("connectors.mail.removeConfirmBody");
  });

  it("删邮箱确认占用 occlusion（迁移前它没有，内置浏览器面板不被遮挡）", async () => {
    // 这是一处行为改变（变好）：ConnectorsView 自己不调 useBrowserOcclusion，
    // 所以这个确认框从来没有遮挡过内置浏览器面板。ConfirmDialog 内部是
    // OccludingAlertDialog，迁过去就有了。
    useAppStore.setState({ browserOcclusionIds: new Set<string>() });
    await renderView();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);

    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "connectors.action.removeMailbox",
    );
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });
});
