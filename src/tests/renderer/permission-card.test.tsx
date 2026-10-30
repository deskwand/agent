// @vitest-environment jsdom
//
// PermissionCard / SudoPasswordCard：Dialog 外壳与分屏区域共用的卡片主体。
import i18n from "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionCard } from "../../renderer/components/split/PermissionCard";
import { SudoPasswordCard } from "../../renderer/components/split/SudoPasswordCard";

const respondToPermission = vi.fn();
const respondToSudoPassword = vi.fn();

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ respondToPermission, respondToSudoPassword }),
}));

const permission = {
  toolUseId: "tool-1",
  toolName: "bash",
  input: { command: "ls" },
  sessionId: "session-1",
};
const sudoRequest = {
  toolUseId: "sudo-1",
  command: "sudo ls",
  sessionId: "session-1",
};

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  respondToPermission.mockClear();
  respondToSudoPassword.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("PermissionCard", () => {
  it("extraCount 显示还有 N 条", async () => {
    await render(<PermissionCard permission={permission} extraCount={2} />);
    expect(container.textContent).toContain(
      i18n.t("split.morePermissions", { count: 2 }),
    );
  });

  it("没有 extraCount 时不显示", async () => {
    await render(<PermissionCard permission={permission} />);
    expect(container.textContent).not.toContain(
      i18n.t("split.morePermissions", { count: 0 }),
    );
  });

  it("点允许调用 respondToPermission", async () => {
    await render(<PermissionCard permission={permission} />);
    await act(async () => {
      buttonByLabel(i18n.t("permission.allow")).click();
    });
    expect(respondToPermission).toHaveBeenCalledWith("tool-1", "allow");
  });

  it("始终允许先确认，取消不应答，再确认只应答一次", async () => {
    await render(<PermissionCard permission={permission} />);
    await act(async () =>
      buttonByLabel(i18n.t("permission.alwaysAllow")).click(),
    );
    expect(respondToPermission).not.toHaveBeenCalled();
    // 文案必须走 i18n（`alwaysAllowConfirm` 带 toolName 参数），不是硬编码英文句。
    expect(container.textContent).toContain(
      i18n.t("permission.alwaysAllowConfirm", { toolName: "bash" }),
    );
    expect(container.textContent).not.toContain("Are you sure");
    // 确认态的取消键只退出确认态：文案不能再是「拒绝」（会被读成拒绝这次调用）。
    await act(async () =>
      buttonByLabel(i18n.t("permission.cancelAlwaysAllow")).click(),
    );
    expect(respondToPermission).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(
      i18n.t("permission.alwaysAllowConfirm", { toolName: "bash" }),
    );
    await act(async () =>
      buttonByLabel(i18n.t("permission.alwaysAllow")).click(),
    );
    await act(async () =>
      buttonByLabel(i18n.t("permission.confirmAlwaysAllow")).click(),
    );
    expect(respondToPermission).toHaveBeenCalledTimes(1);
    expect(respondToPermission).toHaveBeenCalledWith("tool-1", "allow_always");
  });

  it("非高危工具点始终允许直接应答，不进确认态", async () => {
    await render(
      <PermissionCard permission={{ ...permission, toolName: "read" }} />,
    );
    await act(async () =>
      buttonByLabel(i18n.t("permission.alwaysAllow")).click(),
    );
    expect(respondToPermission).toHaveBeenCalledTimes(1);
    expect(respondToPermission).toHaveBeenCalledWith("tool-1", "allow_always");
    expect(container.textContent).not.toContain(
      i18n.t("permission.alwaysAllowConfirm", { toolName: "read" }),
    );
  });

  it("二次确认块里不再出现「拒绝」这个语义", async () => {
    await render(<PermissionCard permission={permission} />);
    await act(async () =>
      buttonByLabel(i18n.t("permission.alwaysAllow")).click(),
    );
    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent?.trim() ?? "",
    );
    // 一次性拒绝键仍在主操作区（一次），确认态不得再多一个同文案按钮。
    expect(
      labels.filter((label) => label === i18n.t("permission.deny")),
    ).toHaveLength(1);
    expect(labels).toContain(i18n.t("permission.cancelAlwaysAllow"));
    expect(labels).toContain(i18n.t("permission.confirmAlwaysAllow"));
    expect(labels).not.toContain(i18n.t("permission.alwaysAllow"));
  });

  it("有 sessionTitle 时显示来源和跳转按钮", async () => {
    const onJump = vi.fn();
    await render(
      <PermissionCard
        permission={permission}
        sessionTitle="Alpha"
        onJump={onJump}
      />,
    );
    expect(container.textContent).toContain(
      i18n.t("split.permissionFromSession", { name: "Alpha" }),
    );
    await act(async () => {
      buttonByLabel(i18n.t("split.jumpToSession")).click();
    });
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});

describe("SudoPasswordCard", () => {
  it("extraCount 与来源跳转", async () => {
    const onJump = vi.fn();
    await render(
      <SudoPasswordCard
        request={sudoRequest}
        extraCount={3}
        sessionTitle="Beta"
        onJump={onJump}
      />,
    );
    expect(container.textContent).toContain(
      i18n.t("split.moreSudoRequests", { count: 3 }),
    );
    expect(container.textContent).toContain(
      i18n.t("split.permissionFromSession", { name: "Beta" }),
    );
    await act(async () => {
      buttonByLabel(i18n.t("split.jumpToSession")).click();
    });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("取消调用 respondToSudoPassword(null)", async () => {
    await render(<SudoPasswordCard request={sudoRequest} />);
    await act(async () => {
      buttonByLabel(i18n.t("sudo.cancel")).click();
    });
    expect(respondToSudoPassword).toHaveBeenCalledWith("sudo-1", null);
  });
});
