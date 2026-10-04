// @vitest-environment jsdom
/**
 * MailAccountDialog 的回归测试。
 *
 * 它守的是「**先测后写**」的外部表现：连不上时不得关闭对话框，
 * 也不得让用户以为加成了 —— 错误必须留在屏幕上。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailAccountDialog } from "../../renderer/components/connectors/MailAccountDialog";

const api = vi.hoisted(() => {
  const mail = { addAccount: vi.fn() };
  // ConnectorsView（「添加」菜单那一组用例）在**模块作用域**读 window.electronAPI，
  // 挂载后还会订阅状态推送 —— 少了它就抛在 effect 里，整个视图变成空壳。
  const connectors = {
    list: vi.fn(async () => []),
    onStatusChanged: vi.fn(() => () => undefined),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    mail,
    connectors,
  };
  return { mail, connectors };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../renderer/hooks/useBrowserOcclusion", () => ({
  useBrowserOcclusion: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onAdded = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(): void {
  act(() => {
    root.render(<MailAccountDialog isOpen onClose={onClose} onAdded={onAdded} />);
  });
}

function click(node: Element): void {
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function byTestId(id: string): HTMLElement {
  return container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
}

async function fill(value: string, testId: string): Promise<void> {
  const input = byTestId(testId) as HTMLInputElement;
  await act(async () => {
    // React 的受控 input 必须走原生 setter 才认
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("MailAccountDialog", () => {
  it("offers all eight providers on the first screen", () => {
    render();
    const ids = [
      "qq",
      "netease-163",
      "netease-126",
      "exmail",
      "aliyun",
      "gmail",
      "icloud",
      "custom",
    ];
    for (const id of ids) {
      expect(byTestId(`mail-provider-${id}`)).toBeTruthy();
    }
  });

  it("goes to the credential screen only after a provider is picked", () => {
    render();
    expect(container.querySelector('[data-testid="mail-email"]')).toBeNull();
    click(byTestId("mail-provider-qq"));
    expect(byTestId("mail-email")).toBeTruthy();
    expect(byTestId("mail-credential")).toBeTruthy();
    // 预设的主机不展示给用户（只有 custom 才让填）
    expect(container.querySelector('[data-testid="mail-imap-host"]')).toBeNull();
  });

  it("asks for hosts only when the provider is custom", () => {
    render();
    click(byTestId("mail-provider-qq"));
    // 回到第一屏再选 custom
    click(container.querySelector("[data-testid=mail-back]") as Element);
    click(byTestId("mail-provider-custom"));
    expect(byTestId("mail-imap-host")).toBeTruthy();
    expect(byTestId("mail-smtp-host")).toBeTruthy();
  });

  it("keeps the connect button disabled while required fields are empty", async () => {
    render();
    click(byTestId("mail-provider-qq"));
    expect((byTestId("mail-submit") as HTMLButtonElement).disabled).toBe(true);
    await fill("zhangsan@qq.com", "mail-email");
    expect((byTestId("mail-submit") as HTMLButtonElement).disabled).toBe(true);
    await fill("abcd1234efgh5678", "mail-credential");
    expect((byTestId("mail-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the failure inline and does not close", async () => {
    api.mail.addAccount.mockResolvedValue({
      ok: false,
      error: "认证失败。请填授权码。",
    });
    render();
    click(byTestId("mail-provider-qq"));
    await fill("zhangsan@qq.com", "mail-email");
    await fill("wrong", "mail-credential");
    await act(async () => {
      (byTestId("mail-submit") as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("认证失败。请填授权码。");
    expect(onClose).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("closes and reports success on ok", async () => {
    api.mail.addAccount.mockResolvedValue({ ok: true });
    render();
    click(byTestId("mail-provider-qq"));
    await fill("zhangsan@qq.com", "mail-email");
    await fill("abcd1234efgh5678", "mail-credential");
    await act(async () => {
      (byTestId("mail-submit") as HTMLButtonElement).click();
    });
    expect(api.mail.addAccount).toHaveBeenCalledWith({
      providerId: "qq",
      email: "zhangsan@qq.com",
      credential: "abcd1234efgh5678",
    });
    expect(onAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("redacts the credential when the backend echoes it back in an error", async () => {
    // **错误文案必须真的包含凭据**，否则这条测试什么都守不住：
    // 原来 mock 的是 "nope"，它本来就不含凭据，于是断言恒真 ——
    // 把脱敏整个关掉，8 条用例照样全绿（已验证）。
    // 这里模拟真实失败：IMAP/SMTP 库或服务端把认证串原样回显在错误里。
    api.mail.addAccount.mockResolvedValue({
      ok: false,
      error: 'Authentication failed (535) for user zhangsan@qq.com, code SECRETCODE',
    });
    render();
    click(byTestId("mail-provider-qq"));
    await fill("zhangsan@qq.com", "mail-email");
    await fill("SECRETCODE", "mail-credential");
    await act(async () => {
      (byTestId("mail-submit") as HTMLButtonElement).click();
    });
    const alert = container.querySelector('[role="alert"]');
    const text = alert?.textContent ?? "";
    expect(text).not.toContain("SECRETCODE");
    // 断言「确实做了替换」，而不是仅仅「恰好没有」——
    // 后一种写法在文案变化时会静默失效。
    expect(text).toContain("***");
    // 其余诊断信息要保留，别为了脱敏把整条错误吞掉
    expect(text).toContain("Authentication failed");
  });

  it("does not send a custom mailbox without hosts", async () => {
    render();
    click(byTestId("mail-provider-custom"));
    await fill("a@b.com", "mail-email");
    await fill("secret", "mail-credential");
    await act(async () => {
      (byTestId("mail-submit") as HTMLButtonElement).click();
    });
    // 主进程的 resolveEndpointInput 会抛异常；对话框自己先拦下来，错误照样留在屏幕上
    expect(api.mail.addAccount).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
