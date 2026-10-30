// @vitest-environment jsdom
//
// PermissionDialog 迁移后的外壳不变量。
//
// 这个弹窗的特殊之处：它**不可关闭**。父级按「有待答权限」挂载它，
// 没有 isOpen，原实现也完全不处理 Esc —— 唯一的出口是三个按钮。
//
// 为什么必须钉住：迁到 Dialog 会让 Esc 经 onOpenChange(false) 把弹窗关掉，
// 而父级仍认为有待答权限 → 弹窗消失、权限未应答、agent 卡住。
// 所以这里锁的是「Esc 之后弹窗还在、且没有触发任何应答」。
//
// 查询作用域是 document.body：Radix 经 Portal 挂载（见 confirm-dialog.test.tsx）。
import "../../renderer/i18n/config";
// i18n 实例本身也要：文案断言与它比对，不抄文案、也不断言 key
import i18n from "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { PermissionDialog } from "../../renderer/components/PermissionDialog";

/** 应答走 IPC；测试里拦下来，只看「调用了几次、参数是什么」。 */
const respondToPermission = vi.fn();

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    respondToPermission,
    respondToSudoPassword: vi.fn(),
  }),
}));

const permission = {
  toolUseId: "tool-1",
  toolName: "bash",
  input: { command: "rm -rf /tmp/x" },
  sessionId: "session-1",
};

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  respondToPermission.mockClear();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("PermissionDialog 外壳", () => {
  it("常驻占用 browser occlusion", async () => {
    await render(<PermissionDialog permission={permission} />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });

  it("卸载时释放 occlusion", async () => {
    await render(<PermissionDialog permission={permission} />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    await act(async () => {
      root.render(<div />);
    });
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("Esc 不关闭弹窗、也不触发任何应答", async () => {
    // Review Focus #2：不可关闭型弹窗的 Esc 必须什么都不发生
    await render(<PermissionDialog permission={permission} />);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(
      document.body.querySelector('[role="alertdialog"]'),
      "弹窗必须仍在 DOM 里（Esc 不得关闭它）",
    ).not.toBeNull();
    expect(respondToPermission, "Esc 不得代为应答").not.toHaveBeenCalled();
  });

  it("六个高危工具的警告都在", async () => {
    // 这条是评审抓到的回归的守卫：迁移时 PermissionDialog 的 isHighRisk 清单
    // 从 6 项被误缩到 4 项（丢了 write_file / edit_file），而**当时没有任何测试
    // 钉住这个集合**，所以静默通过 —— 权限 UI 上「高危」的琥珀色警告会消失、
    // 退回中性的蓝色盾牌。这条用例按行为断言（警告文案在不在），不抄清单本身。
    for (const toolName of [
      "bash",
      "write",
      "edit",
      "execute_command",
      "write_file",
      "edit_file",
    ]) {
      await render(
        <PermissionDialog permission={{ ...permission, toolName }} />,
      );
      expect(
        document.body.textContent,
        `${toolName} 必须被当作高危（要出现 warning 文案）`,
      ).toContain(i18n.t("permission.warning"));
      await act(async () => {
        root.render(<div />);
      });
      document
        .querySelectorAll('[role="dialog"], [role="alertdialog"]')
        .forEach((el) => el.remove());
    }
  });

  it("非高危工具不显示警告", async () => {
    await render(
      <PermissionDialog permission={{ ...permission, toolName: "read" }} />,
    );
    expect(document.body.textContent).not.toContain(
      i18n.t("permission.warning"),
    );
  });

  it("渲染出工具名与授权按钮", async () => {
    await render(<PermissionDialog permission={permission} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("bash");
    // 三个出口按钮都在 —— 按 i18n 标签断言，不按数量。
    // 数量断言（>=3）验不出任何东西：少一个、多一个都能过。
    const labels = Array.from(document.body.querySelectorAll("button")).map(
      (b) => b.textContent?.trim() ?? "",
    );
    expect(labels).toContain(i18n.t("permission.allow"));
    expect(labels).toContain(i18n.t("permission.deny"));
    expect(labels).toContain(i18n.t("permission.alwaysAllow"));
  });

  it("二次确认文案走 i18n，不出现硬编码英文", async () => {
    await render(<PermissionDialog permission={permission} />);
    const alwaysAllow = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === i18n.t("permission.alwaysAllow"),
    );
    expect(alwaysAllow).toBeTruthy();
    await act(async () => {
      alwaysAllow!.click();
    });
    // bash 属高危工具 ⇒ 第一次点击只进确认态，不应发出应答
    expect(respondToPermission).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      i18n.t("permission.alwaysAllowConfirm", { toolName: "bash" }),
    );
    expect(document.body.textContent).not.toContain("Are you sure");
  });
});
