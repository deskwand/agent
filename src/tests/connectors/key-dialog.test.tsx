// @vitest-environment jsdom
/**
 * KeyDialog 的回归测试。
 *
 * 这一层守的是「key 型条目**不走 OAuth**」：对话框只调 `connectWithKey`，
 * 并且凭据为空时不许发请求 —— 空凭据写进配置会留下一个永远连不上、
 * 界面上却显示「已授权」的 server。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyDialog } from "../../renderer/components/connectors/KeyDialog";
import type { ConnectorEntry } from "../../shared/connectors";

const api = vi.hoisted(() => {
  const connectors = {
    connectWithKey: vi.fn(),
  };
  // 组件在**模块作用域**读 window.electronAPI，所以它必须在 import 之前就存在
  (window as unknown as { electronAPI: unknown }).electronAPI = { connectors };
  return connectors;
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useBrowserOcclusion", () => ({
  useBrowserOcclusion: vi.fn(),
}));

const ENTRY: ConnectorEntry = {
  key: "mcp:catalog:gitee",
  serverName: "gitee",
  source: "mcp-remote",
  transport: "http",
  nameKey: "connectors.catalog.gitee",
  descriptionKey: "connectors.catalog.giteeDesc",
  category: "dev",
  auth: {
    kind: "key",
    placement: "header",
    name: "Authorization",
    valuePrefix: "Bearer ",
    consoleUrl: "https://gitee.com/profile/personal_access_tokens",
    credentialLabelKey: "connectors.catalog.giteeCredential",
  },
  instances: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  api.connectWithKey.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function input(): HTMLInputElement {
  return container.querySelector(
    '[data-testid="key-credential"]',
  ) as HTMLInputElement;
}

function submitButton(): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("connectors.keyDialog.submit"),
  ) as HTMLButtonElement;
}

async function mount(entry: ConnectorEntry | null): Promise<void> {
  await act(async () => {
    root.render(
      <KeyDialog
        entry={entry}
        onClose={() => undefined}
        onConnected={() => undefined}
      />,
    );
  });
}

async function type(value: string): Promise<void> {
  const el = input();
  // 必须走原型上的原生 setter：直接 `el.value = …` 会被 React 的 value tracker
  // 忽略，受控输入收不到值（同 add-server-dialog.test.tsx 的写法）。
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("KeyDialog", () => {
  it("renders nothing for a null entry", async () => {
    await mount(null);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for an OAuth entry", async () => {
    // 缺省 auth（= OAuth）的条目走的是浏览器授权，弹这个框只会误导用户去粘凭据
    await mount({ ...ENTRY, auth: { kind: "oauth" } });
    expect(container.textContent).toBe("");
  });

  it("shows the vendor credential label and the console link", async () => {
    await mount(ENTRY);
    expect(container.textContent).toContain(
      "connectors.catalog.giteeCredential",
    );
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(
      "https://gitee.com/profile/personal_access_tokens",
    );
  });

  it("renders nothing for an entry without auth (default oauth)", async () => {
    // 缺省即 OAuth —— 条目没写 auth 时走的是浏览器授权，弹这个框只会误导用户去粘凭据
    await mount({ ...ENTRY, auth: undefined });
    expect(container.textContent).toBe("");
  });

  it("sends the trimmed credential keyed by server name", async () => {
    await mount(ENTRY);
    await type("  tok-123  ");
    await act(async () => {
      submitButton().click();
    });
    expect(api.connectWithKey).toHaveBeenCalledWith("gitee", "tok-123");
  });

  it("refuses an empty credential without calling the backend", async () => {
    await mount(ENTRY);
    await type("   ");
    await act(async () => {
      submitButton().click();
    });
    expect(api.connectWithKey).not.toHaveBeenCalled();
    expect(container.textContent).toContain("connectors.keyDialog.empty");
  });

  it("keeps the input and shows the failure inline", async () => {
    api.connectWithKey.mockResolvedValue({ ok: false, error: "boom" });
    await mount(ENTRY);
    await type("tok");
    await act(async () => {
      submitButton().click();
    });
    expect(container.textContent).toContain("boom");
    expect(input().value).toBe("tok");
  });

  it("reports the result to the caller on success", async () => {
    const onConnected = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <KeyDialog entry={ENTRY} onClose={onClose} onConnected={onConnected} />,
      );
    });
    await type("tok");
    await act(async () => {
      submitButton().click();
    });
    expect(onConnected).toHaveBeenCalledWith({ ok: true });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("KeyDialog：父组件重渲染不能吃掉正在粘的凭据", () => {
  it("keeps the typed credential when onClose gets a new identity", async () => {
    // ConnectorsView 传的是内联箭头函数，每次渲染都是新身份；而状态推送
    // （connectors.statusChanged → refresh）会让它频繁渲染。之前重置 effect 的
    // 依赖里有 onClose，于是用户粘一半的 PAT 会被静默清空。
    const render = async (onClose: () => void): Promise<void> => {
      await act(async () => {
        root.render(
          <KeyDialog
            entry={ENTRY}
            onClose={onClose}
            onConnected={() => undefined}
          />,
        );
      });
    };

    await render(() => undefined);
    await type("ghp_veryLongToken");
    await render(() => undefined);

    expect(input().value).toBe("ghp_veryLongToken");
  });

  it("closes on Escape through the latest onClose", async () => {
    const first = vi.fn();
    await act(async () => {
      root.render(
        <KeyDialog
          entry={ENTRY}
          onClose={first}
          onConnected={() => undefined}
        />,
      );
    });
    const second = vi.fn();
    await act(async () => {
      root.render(
        <KeyDialog
          entry={ENTRY}
          onClose={second}
          onConnected={() => undefined}
        />,
      );
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});
