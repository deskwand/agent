// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../../renderer/components/AccountMenu";
import { AccountCluster } from "../../renderer/components/AccountCluster";
import { useAppStore } from "../../renderer/store";
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
    open: true,
    onOpenChange: vi.fn(),
    trigger: React.createElement("button", { type: "button" }, "T"),
    cloudConfig: null,
    cloudRestoring: false,
    onOpenLogin: vi.fn(),
    onOpenSettings: vi.fn(),
    onLogout: vi.fn(),
    ...props,
  } as React.ComponentProps<typeof AccountMenu>;
  act(() => {
    root.render(React.createElement(AccountMenu, merged));
  });
}

describe("AccountMenu 已登录结构", () => {
  beforeEach(() => renderMenu({ cloudConfig: loggedIn }));

  it("身份区：邮箱首字母头像 + 完整邮箱", () => {
    expect(document.body.textContent).toContain("JZ");
    expect(document.body.textContent).toContain("jichun.zou@eacon.com");
  });

  it("菜单组：设置 / 余额一行含充值（用量与更新不在这里）", () => {
    expect(document.body.textContent).toContain("sidebar.settings");
    expect(document.body.textContent).not.toContain("accountMenu.usage");
    expect(document.body.textContent).not.toContain("update.title");
    expect(document.body.textContent).toContain("accountMenu.balance");
    expect(document.body.textContent).toContain("$12.30");
    expect(document.body.textContent).toContain("accountMenu.topUpAction");
  });

  it("点设置行走 onOpenSettings 并关闭弹层", () => {
    // 迁到 Radix 后：① 菜单行是 div[role="menuitem"]（不是 button）；
    // ② 「关闭」由 DropdownMenuItem 自动触发 onOpenChange(false) ——
    //    调用方要的「关掉弹层」能力仍在（AccountCluster 的 onOpenSettings
    //    自己也 setAccountMenuOpen(false)，两处都不冲突）。
    const onOpenSettings = vi.fn();
    const onOpenChange = vi.fn();
    renderMenu({
      cloudConfig: loggedIn,
      onOpenSettings,
      onOpenChange,
    });

    const settingsRow = [
      ...document.body.querySelectorAll('[role="menuitem"]'),
    ].find((b) => b.textContent === "sidebar.settings");
    expect(settingsRow, "设置行必须存在").toBeTruthy();
    act(() => (settingsRow as HTMLElement).click());

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenChange, "点菜单项应当关掉弹层").toHaveBeenCalledWith(false);
  });

  it("退出登录在菜单里，且菜单行仍是 h-7 的形态", () => {
    // 判据从「用共享 token」换成「Radix 的菜单项 + 同一个 h-7 形态」——
    // 约束（菜单行高度统一）没变，载体变了。
    expect(document.body.textContent).toContain("auth.logout");
    const logoutRow = [
      ...document.body.querySelectorAll('[role="menuitem"]'),
    ].find((b) => b.textContent === "auth.logout");
    expect(logoutRow?.className, "菜单行仍是 h-7").toContain("h-7");
    expect(logoutRow?.className).toContain("h-7");
  });
});

describe("AccountMenu 未登录结构", () => {
  it("无身份区、无余额行，保留设置与登录入口", () => {
    renderMenu({ cloudConfig: null });
    expect(document.body.textContent).not.toContain("@");
    expect(document.body.textContent).not.toContain("JZ");
    expect(document.body.textContent).not.toContain("accountMenu.balance");
    expect(document.body.textContent).toContain("auth.loginEntry");
    // 用量在图标栏上，不再回账号弹层
    expect(document.body.textContent).not.toContain("accountMenu.usage");
  });
});

describe("AccountMenu 恢复中", () => {
  it("cloudRestoring 时不渲染登录/退出登录分支，只留占位行", () => {
    renderMenu({ cloudRestoring: true, cloudConfig: null });
    expect(document.body.textContent).not.toContain("auth.loginEntry");
    expect(document.body.textContent).not.toContain("auth.logout");
    expect(document.body.textContent).toContain("...");
  });
});

describe("AccountMenu 迁到 Radix 后的新契约", () => {
  it("菜单是 DropdownMenu：role=menu 且经 Portal 挂在 body 下", () => {
    renderMenu({ cloudConfig: loggedIn });
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(
      container.querySelector('[role="menu"]'),
      "不应留在本地 container 里",
    ).toBeNull();
  });

  it("受控：open=false 时不渲染菜单（调用方仍能程序化关闭）【Review Focus #1】", () => {
    // AccountCluster 的 onOpenSettings 依赖这个能力。若实现用了 defaultOpen
    // 而不是受控的 open，这条会红。
    renderMenu({ open: false, cloudConfig: loggedIn });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("余额行与宠物开关都键盘可达，且没有按钮嵌套【Review Critical #2】", () => {
    // ⚠️ 这条**取代**了原先的「余额行不能是 menuitem」—— 那个判断在评审里被推翻了：
    // Radix 的菜单会 `preventDefault` 掉 Tab、只在**注册过的 item** 间 rove 焦点，
    // 所以行内嵌一个普通 button（或余额行保持 div）会让它在键盘上完全不可达 ✗。
    // 正确做法是「做成菜单项，并**删掉**内嵌的那个按钮」——
    // 这样键盘可达 ✓ 且没有按钮嵌套 ✓（原实现避免嵌套的意图仍然满足）。
    renderMenu({ cloudConfig: loggedIn });

    const balanceRow = [
      ...document.body.querySelectorAll('[role="menuitem"]'),
    ].find((el) => el.textContent?.includes("accountMenu.balance"));
    expect(
      balanceRow,
      "余额行必须存在且是菜单项（否则键盘走不到）",
    ).toBeTruthy();
    expect(balanceRow!.querySelector("button"), "不许有嵌套按钮").toBeNull();

    const sw = document.body.querySelector('[role="switch"]');
    expect(sw, "宠物开关必须存在").toBeTruthy();
    expect(sw!.getAttribute("aria-checked")).toBeTruthy();
  });

  it("真实 AccountCluster 的触发器带 aria-haspopup=menu（Review Critical #1 的回归闸）", () => {
    // ⚠️ 给 Critical #1 兜底：本文件其余用例都传**裸 button** 当 trigger，
    // 所以「调用方把 trigger 包进 Tooltip」这种**真实**形态没有任何覆盖 ——
    // 而 Radix 的 asChild 会把 onPointerDown / aria-* / ref 交给 Tooltip，
    // 本仓的 Tooltip 既不透传 props 也不 forwardRef → 全丢 → 菜单根本打不开、
    // 且**没有任何报错**。
    useAppStore.setState({ cloudConfig: null, showLoginModal: false });
    act(() => {
      root.render(React.createElement(AccountCluster));
    });
    const btn = container.querySelector('button[aria-label="sidebar.user"]');
    expect(btn, "触发器必须渲染出来").toBeTruthy();
    expect(
      btn!.getAttribute("aria-haspopup"),
      "触发器必须拿到 Radix 的 aria-haspopup（漏了说明 trigger 被包住了）",
    ).toBe("menu");
  });
});
