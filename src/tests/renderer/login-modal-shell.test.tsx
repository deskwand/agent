// @vitest-environment jsdom
//
// LoginModal 的外壳不变量。
//
// 这个弹窗在三个弹窗里是「唯一一个点遮罩会关闭的」—— 原实现的遮罩上有
// onClick={onClose}，正好就是 Radix Dialog 的默认行为，所以本任务**不写**
// onInteractOutside 抑制。下面第一条用例就是钉这件事的。
//
// 登录流程本身（Google / 邮箱 / 验证码）没有既有测试基建，也不属迁移风险面
//（逻辑一行未改），所以这里只测外壳：occlusion、两条关闭路径、面板渲染。
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { LoginModal } from "../../renderer/components/LoginModal";
// 弹窗测试脚手架（本计划 Task 1）：container / render / shell / buttons /
// buttonByLabel / builtinCloseButton / portal 清理都由它提供，本文件不再自己搭
import { setupDialogTest } from "../dialog-test-helpers";

const onClose = vi.fn();
const onLoginSuccess = vi.fn();

/**
 * 脚手架来自 tests/dialog-test-helpers.ts（本计划 Task 1）。
 * 它返回的名字与本文件原本用的局部名字一致，所以下面的测试体逐字未改。
 */
let d: ReturnType<typeof setupDialogTest>;
let container: HTMLDivElement;
let render: (node: ReactNode) => Promise<void>;
let shell: () => Element | null;

function mount(isOpen = true) {
  return render(
    <LoginModal
      isOpen={isOpen}
      onClose={onClose}
      onLoginSuccess={onLoginSuccess}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    cloudAuth: { googleLogin: vi.fn() },
  };
  onClose.mockClear();
  onLoginSuccess.mockClear();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  d = setupDialogTest();
  ({ container, render, shell } = d);
});

afterEach(() => {
  // 卸载 + 移除本地 container + 清 portal 节点，全在 teardown 里（见 Task 1）
  d.teardown();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("LoginModal 外壳", () => {
  it("isOpen 时占用 occlusion，关闭时释放", async () => {
    await mount(true);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await render(
      <LoginModal
        isOpen={false}
        onClose={onClose}
        onLoginSuccess={onLoginSuccess}
      />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("卸载时释放 occlusion", async () => {
    await mount(true);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    await render(<div />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("渲染标题与 Google 登录入口", async () => {
    await mount();
    expect(shell()).not.toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toContain(i18n.t("auth.loginTitle"));
    // 面板与遮罩之外的内容对读屏隐藏（Radix 的模态实现，见陷阱 6）
    expect(container.getAttribute("aria-hidden")).toBe("true");
  });

  it("Esc 关闭", async () => {
    await mount();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          // 陷阱 2：不声明 cancelable 的话 preventDefault 是空操作
          cancelable: true,
        }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点遮罩关闭（与 Radix 默认吻合，未加抑制）", async () => {
    // 陷阱 5：必须派发 click —— DialogContent 传了 deferPointerDownOutside，
    // 主键 pointerdown 会把「外部关闭」推迟到 click。只派发 pointerdown 的话
    // 这条用例会空转（删掉关闭逻辑也照样通过）。
    await mount();
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      container.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose, "点遮罩应当关闭").toHaveBeenCalled();
  });
});
