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

  it("菜单组：设置 / 用量统计（右端 chevron）/ 余额一行含充值", () => {
    expect(container.textContent).toContain("sidebar.settings");
    expect(container.textContent).toContain("accountMenu.usage");
    expect(container.textContent).toContain("accountMenu.balance");
    expect(container.textContent).toContain("$12.30");
    expect(container.textContent).toContain("accountMenu.topUpAction");
    // chevron 是 lucide 的固定 path（m9 18 6-6-6-6）
    expect(
      [...container.querySelectorAll("svg path")].some(
        (p) => p.getAttribute("d") === "m9 18 6-6-6-6",
      ),
    ).toBe(true);
  });

  it("退出登录在菜单里，且菜单行用共享 token（h-7）", () => {
    expect(container.textContent).toContain("auth.logout");
    expect(MENU_ITEM_CLASS).toContain("h-7");
    const settingsRow = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "sidebar.settings",
    );
    expect(settingsRow?.className).toContain("h-7");
  });
});

describe("AccountMenu 未登录结构", () => {
  it("无身份区、无余额行，保留登录入口与本地用量统计", () => {
    renderMenu({ cloudConfig: null });
    expect(container.textContent).not.toContain("@");
    expect(container.textContent).not.toContain("JZ");
    expect(container.textContent).not.toContain("accountMenu.balance");
    expect(container.textContent).toContain("auth.loginEntry");
    expect(container.textContent).toContain("accountMenu.usage");
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
