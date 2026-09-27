// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../../renderer/components/AccountMenu";
import { MENU_ITEM_CLASS } from "../../renderer/components/menu-styles";
import type { CloudConfig } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// token 置空：getMe 刷新 effect 提前返回，测试零网络请求
const loggedIn: CloudConfig = {
  serverUrl: "https://api.example.com",
  token: "",
  isLoggedIn: true,
  email: "jichun.zou@eacon.com",
  level: "pro",
  balanceMicroUsd: 12_300_000, // $12.30
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function renderMenu(
  props: Partial<React.ComponentProps<typeof AccountMenu>> = {},
) {
  const merged = {
    isOpen: true,
    cloudConfig: null,
    cloudRestoring: false,
    onOpenLogin: vi.fn(),
    onOpenSettings: vi.fn(),
    onLogout: vi.fn(),
    onClose: vi.fn(),
    ...props,
  };
  act(() => {
    root.render(React.createElement(AccountMenu, merged));
  });
}

describe("AccountMenu 已登录结构", () => {
  beforeEach(() => renderMenu({ cloudConfig: loggedIn }));

  it("身份区：邮箱首字母头像 + 完整邮箱", () => {
    expect(container.textContent).toContain("JZ");
    expect(container.textContent).toContain("jichun.zou@eacon.com");
  });

  it("菜单组：设置 / 余额一行含充值（用量与更新不在这里）", () => {
    expect(container.textContent).toContain("sidebar.settings");
    expect(container.textContent).not.toContain("accountMenu.usage");
    expect(container.textContent).not.toContain("update.title");
    expect(container.textContent).toContain("accountMenu.balance");
    expect(container.textContent).toContain("$12.30");
    expect(container.textContent).toContain("accountMenu.topUpAction");
  });

  it("点设置行走 onOpenSettings 并关闭弹层", () => {
    const onOpenSettings = vi.fn();
    const onClose = vi.fn();
    renderMenu({
      cloudConfig: loggedIn,
      onOpenSettings,
      onClose,
    });

    const settingsRow = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "sidebar.settings",
    );
    expect(settingsRow, "设置行必须存在").toBeTruthy();
    act(() => (settingsRow as HTMLButtonElement).click());

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("退出登录在菜单里，且菜单行用共享 token（h-7）", () => {
    expect(container.textContent).toContain("auth.logout");
    expect(MENU_ITEM_CLASS).toContain("h-7");
    const logoutRow = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "auth.logout",
    );
    expect(logoutRow?.className).toContain("h-7");
  });
});

describe("AccountMenu 未登录结构", () => {
  it("无身份区、无余额行，保留设置与登录入口", () => {
    renderMenu({ cloudConfig: null });
    expect(container.textContent).not.toContain("@");
    expect(container.textContent).not.toContain("JZ");
    expect(container.textContent).not.toContain("accountMenu.balance");
    expect(container.textContent).toContain("auth.loginEntry");
    // 用量在图标栏上，不再回账号弹层
    expect(container.textContent).not.toContain("accountMenu.usage");
  });
});

describe("AccountMenu 恢复中", () => {
  it("cloudRestoring 时不渲染登录/退出登录分支，只留占位行", () => {
    renderMenu({ cloudRestoring: true, cloudConfig: null });
    expect(container.textContent).not.toContain("auth.loginEntry");
    expect(container.textContent).not.toContain("auth.logout");
    expect(container.textContent).toContain("...");
  });
});
