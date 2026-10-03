// @vitest-environment jsdom
/**
 * 连接页（图标栏 apps 项）的返回按钮。
 *
 * 这一页是整页视图（activeView === "apps"），与用量 / 记忆库 / 自动化 / 设置同级。
 * 那四处都有返回键回到聊天（见 tests/vault-view-contract.test.ts 的同名用例），
 * 连接页此前没有 —— 本用例把这条对齐钉住。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../src/renderer/store";
import { ConnectorsView } from "../src/renderer/components/connectors/ConnectorsView";

const api = vi.hoisted(() => {
  const connectors = {
    list: vi.fn(),
    onStatusChanged: vi.fn(),
  };
  // ConnectorsView 在模块作用域用 window.electronAPI 判定 isElectron，
  // 因此它必须在 import 之前就存在 —— 否则视图静默退化成空壳。
  (window as unknown as { electronAPI: unknown }).electronAPI = { connectors };
  return connectors;
});

const TRANSLATIONS: Record<string, string> = {
  "common.back": "Back",
  "connectors.title": "Connect",
  "connectors.subtitle": "Wire external tools into DeskWand",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
    i18n: { language: "en" },
  }),
}));

// 「技能 / 插件」两个子视图的模块在加载时就会被 import，
// 但本用例从不切到那两个 tab —— 与 src/tests/connectors 下的惯例一致，mock 掉。
vi.mock("../src/renderer/components/settings/SettingsSkills", () => ({
  SettingsSkills: () => null,
}));
vi.mock("../src/renderer/components/PiExtensionManagerView", () => ({
  PiExtensionManagerView: () => null,
}));

describe("connectors view header", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState(), true);
    // 先站到连接页：否则「点击后是 chat」这条断言在初始态就已经成立，恒真。
    useAppStore.setState({ activeView: "apps" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.list.mockResolvedValue([]);
    api.onStatusChanged.mockImplementation(() => () => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderConnectors(): Promise<void> {
    await act(async () => {
      root.render(createElement(ConnectorsView));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("returns to chat from the connectors header", async () => {
    await renderConnectors();

    // 反恒真护栏：初始就得站在连接页，否则下面「点击后是 chat」恒成立。
    expect(useAppStore.getState().activeView).toBe("apps");

    const back = container.querySelector('button[aria-label="Back"]');
    if (!(back instanceof HTMLButtonElement)) {
      throw new Error("Back button missing");
    }
    expect(back.querySelector("svg.lucide-arrow-left")).not.toBeNull();

    // 「头部左侧」是 spec 的验收标准，必须被钉住：整棵树的范围查询在有多个
    // 返回键或按钮被挪到标签栏里时依然会通过。所以要求它与标题同行、且在标题左边。
    const title = Array.from(container.querySelectorAll("h2")).find(
      (node) => node.textContent === "Connect",
    );
    expect(title).not.toBeNull();
    expect(back.parentElement).toBe(title!.parentElement);
    expect(
      back.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      back.click();
    });

    expect(useAppStore.getState().activeView).toBe("chat");
  });
});
