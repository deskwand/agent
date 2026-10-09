// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AccountMenu } from "../src/renderer/components/AccountMenu";
import { ChatInputStatusBar } from "../src/renderer/components/ChatInputStatusBar";
import { FilePreviewPanel } from "../src/renderer/components/FilePreviewPanel";
import { GlobalNoticeToast } from "../src/renderer/components/GlobalNoticeToast";
import { LoginModal } from "../src/renderer/components/LoginModal";
import { SandboxSyncToast } from "../src/renderer/components/SandboxSyncToast";
import { useAppStore } from "../src/renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const readRendererFile = (relativePath: string): string =>
  readFileSync(
    path.resolve(process.cwd(), "src/renderer", relativePath),
    "utf8",
  );

const globalStyles = readRendererFile("styles/globals.css");

describe("renderer motion policy", () => {
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
    // 弹窗内容经 Portal 挂在 document.body，清掉以免跨用例污染
    document
      .querySelectorAll('[role="dialog"], [role="alertdialog"]')
      .forEach((el) => el.remove());
  });

  it("renders modal entrance classes on the final DOM", () => {
    // 迁移后弹窗由 shadcn 的 Dialog 承担，入场动画的**机制**变了：
    // 从本仓手写的 modal-overlay + animate-fade-in + animate-slide-up，
    // 变成 Radix/shadcn 的 data-[state=open]:animate-in + fade-in-0 + zoom-in-95。
    //
    // **策略不变，这条用例守的就是它**：弹窗仍必须有入场动画，不能突然出现。
    // 另外内容现在经 Portal 挂到 document.body，不在本文件的 container 里。
    //
    // 注：LoginModal 的 open 是受控的 isOpen，所以 data-state 真的会迁到 open、
    // 动画真的会跑（与 SandboxSetupDialog 相反 —— 那个的 open 恒为 true，
    // Radix 看不到状态迁移，退场动画不会跑）。
    act(() => {
      root.render(
        createElement(LoginModal, {
          isOpen: true,
          onClose: () => undefined,
          onLoginSuccess: () => undefined,
        }),
      );
    });

    const content = document.body.querySelector('[role="dialog"]');
    expect(content, "弹窗内容必须存在").not.toBeNull();
    expect(content?.className, "内容要有入场动画").toContain(
      "data-[state=open]:animate-in",
    );
    expect(content?.className, "内容的淡入具体形式").toContain(
      "data-[state=open]:fade-in-0",
    );
    // 原实现的 animate-slide-up 是**有方向性的动效**，所以这里也要钉住「不止是淡入」——
    // 否则「只有 opacity、没有任何位移/缩放」也会通过。
    expect(content?.className, "内容还要有缩放/位移动效").toContain(
      "data-[state=open]:zoom-in-95",
    );

    const overlay = content?.previousElementSibling;
    expect(overlay, "覆盖层必须存在").not.toBeNull();
    expect(overlay?.className, "覆盖层也要淡入").toContain(
      "data-[state=open]:fade-in-0",
    );
  });

  it("keeps heavy file previews free of full-screen blur and entrance transforms", () => {
    useAppStore.setState({
      previewTabs: [{ path: "/tmp/example.txt", name: "example.txt" }],
      activePreviewTab: "/tmp/example.txt",
      rightPanelMode: "preview",
    });
    act(() => {
      root.render(createElement(FilePreviewPanel));
    });

    const panel = container.firstElementChild;
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[data-testid="preview-tab"]')).not.toBeNull();
    expect(panel?.classList.contains("bg-black/40")).toBe(false);
    expect(panel?.classList.contains("modal-overlay")).toBe(false);
    expect(panel?.classList.contains("animate-fade-in")).toBe(false);
    expect(panel?.classList.contains("backdrop-blur-sm")).toBe(false);
    expect(
      panel?.firstElementChild?.classList.contains("animate-slide-up"),
    ).toBe(false);
  });

  it("renders directional toast entrance classes on the final DOM", () => {
    act(() => {
      root.render(
        createElement(GlobalNoticeToast, {
          notice: { id: "notice", type: "info", message: "Saved" },
          onDismiss: () => undefined,
          onAction: () => undefined,
        }),
      );
    });
    expect(
      container.firstElementChild?.classList.contains("animate-toast-in-top"),
    ).toBe(true);

    act(() => {
      root.render(
        createElement(SandboxSyncToast, {
          status: {
            sessionId: "session",
            phase: "syncing_files",
            message: "Syncing",
          },
        }),
      );
    });
    const classes = container.firstElementChild?.classList;
    expect(classes?.contains("animate-toast-in-bottom")).toBe(true);
    expect(classes?.contains("transition-[opacity,transform]")).toBe(true);
    expect(classes?.contains("duration-200")).toBe(true);
  });

  it("remounts the global notice when a new notice replaces it", () => {
    const renderNotice = (id: string) =>
      createElement(GlobalNoticeToast, {
        notice: { id, type: "info" as const, message: id },
        onDismiss: () => undefined,
        onAction: () => undefined,
      });

    act(() => root.render(renderNotice("first")));
    const firstNode = container.firstElementChild;

    act(() => root.render(renderNotice("second")));
    expect(container.firstElementChild).not.toBe(firstNode);
  });

  it("adds press feedback to core goal and notice actions", () => {
    act(() => {
      root.render(
        createElement(ChatInputStatusBar, {
          status: { type: "goal-paused", objective: "Ship", iteration: 1 },
          onGoalCommand: () => undefined,
        }),
      );
    });

    for (const button of container.querySelectorAll("button")) {
      expect(button.classList.contains("active:scale-[0.97]")).toBe(true);
      expect(
        button.classList.contains(
          "transition-[transform,background-color,color]",
        ),
      ).toBe(true);
    }

    act(() => {
      root.render(
        createElement(GlobalNoticeToast, {
          notice: {
            id: "notice-action",
            type: "info",
            message: "Configure",
            action: "open_api_settings",
          },
          onDismiss: () => undefined,
          onAction: () => undefined,
        }),
      );
    });

    const noticeButtons = container.querySelectorAll("button");
    const actionButton = noticeButtons[noticeButtons.length - 1];
    expect(actionButton.classList.contains("active:scale-[0.97]")).toBe(true);
    expect(
      actionButton.classList.contains(
        "transition-[transform,background-color,color]",
      ),
    ).toBe(true);
  });

  it("uses the upward menu entrance for the account menu", () => {
    // 意图不变（账号菜单要有入场动画、不能硬弹出来），机制换了：
    // 原实现手写 `animate-menu-in-up`，迁到 Radix 后入场动画由 vendored 的
    // dropdown-menu.tsx 提供（data-[state=open]:animate-in），方向由 side 决定。
    act(() => {
      root.render(
        createElement(AccountMenu, {
          open: true,
          onOpenChange: () => undefined,
          trigger: createElement("button", { type: "button" }, "T"),
          cloudConfig: null,
          onOpenLogin: () => undefined,
          onOpenSettings: () => undefined,
          onLogout: () => undefined,
        }),
      );
    });

    const content = document.body.querySelector('[role="menu"]');
    expect(content, "菜单必须渲染出来").not.toBeNull();
    expect(
      content!.className,
      "入场动画由 shadcn 的 data-[state=open]:animate-in 提供",
    ).toContain("data-[state=open]:animate-in");

    // 光有「有动画」还不够 —— 这条用例原名是「**upward** menu entrance」。
    // 迁到 Radix 后「朝哪个方向展开」由 side 表达，所以必须一并断言，
    // 否则「任意方向」都能过，方向回归就看不见了。
    const source = readFileSync(
      "src/renderer/components/AccountMenu.tsx",
      "utf8",
    );
    expect(
      source,
      "账号菜单仍要朝图标栏右侧展开（原来是 animate-menu-in-up + left-full）",
    ).toContain('side="right"');
  });

  it("defines scoped reduced-motion fallbacks without hover zoom", () => {
    expect(globalStyles).toContain("--motion-fast: 150ms;");
    expect(globalStyles).toContain("--motion-standard: 200ms;");
    expect(globalStyles).toContain(
      "--ease-ui-out: cubic-bezier(0.23, 1, 0.32, 1);",
    );
    // 动效时序只有一个来源（设计文档 §8）。
    // 不直接匹配若干已知名字，而是把已声明的自定义属性全找出来再过滤——
    // 这样未来无论用 --dur-x / --duration-x / --time-x 引入第二套，都会被抓到。
    const declared = [...globalStyles.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(
      (m) => m[1],
    );
    expect(
      [...new Set(declared.filter((n) => /^--ease-/.test(n)))].sort(),
    ).toEqual(["--ease-ui-out"]);
    expect([
      ...new Set(declared.filter((n) => /^--(?:dur|duration|time)-/.test(n))),
    ]).toEqual([]);
    expect(globalStyles).toContain("@keyframes menu-in-up");
    expect(globalStyles).toContain("@keyframes menu-in-down");
    expect(globalStyles).not.toContain("@keyframes eff-message-in");
    expect(globalStyles).not.toContain("@keyframes eff-float");
    expect(globalStyles).not.toContain(".eff-message-enter");
    expect(globalStyles).not.toContain(".eff-float");
    expect(globalStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.animate-slide-up,[\s\S]*\.animate-toast-in-top,[\s\S]*\.animate-toast-in-bottom,[\s\S]*\.animate-menu-in-up,[\s\S]*\.animate-menu-in-down[\s\S]*animation-name: fade-in !important;/,
    );
    // 按钮状态不再靠阴影：暗色下阴影不可见，hover 由各自的 hover:bg-* 承担（设计文档 §4.3 规则 C）
    expect(globalStyles).not.toMatch(/\.btn:hover\s*\{/);
    // 用 [^}]* 限定在同一规则内，避免跨过大括号误捕到后面规则的 box-shadow
    expect(globalStyles).not.toMatch(/\.btn:active\s*\{[^}]*box-shadow/);
    // ⚠️ 2026-10-09：这条原先钉的是 `.card` / `.input` 里那句**收窄过渡**的 `@apply` ✓ ——
    // 而那两个类**已实测零消费者** ✗（`.input` 0 ✓、`.card` 0 ✓，spec 估的 22/19 是错的 ✗）
    // ⇒ 随批次 6 一起删掉了 ✓ ⇒ 这条 `toContain` 的**主语不存在了** ✗✓。
    // **意图不变** ✓（「过渡必须收窄 ✓，不许 `transition-all` ✓」）——
    // 而下面那条 `transition-all → 0` 才是**真正的保证** ✓✓，它比这条更强 ✓；
    // 这里改成**反向钉子** ✓：确认那个死类的过渡规则**确实没了** ✗。
    expect(globalStyles).not.toContain(
      "@apply transition-[border-color,box-shadow,background-color,color]",
    );
    // ⚠️ 同上 ✓：这条钉的是 `.tag` / `.badge` 的收窄过渡 ✓ —— 那两个类也已实测零消费者 ✗ ⇒ 随批次 6 删掉 ✓。
    // **意图不变** ✓（过渡收窄 ✓），由下面那条 `transition-all → 0` 保证 ✓✓；这里改成**反向钉子** ✗。
    expect(globalStyles).not.toContain(
      "transition-[background-color,color] duration-150",
    );
    // ⚠️ 2026-10-09：手搓开关（`.toggle-knob`）已换成 **vendored `ui/switch.tsx`** ✗
    // ⇒ 原先「`transition-all` 只允许出现一次、且只给 toggle-knob 用」✓ 的前提没了 ✓。
    // **意图不变** ✓（「除开关外一律用收窄的 transition 属性」✓）—— 而现在的实际更强 ✓：
    // **全局一次都不允许** ✓✓（vendored Switch 在它自己的文件里写 `transition-transform` ✓，
    // 那不在 `globalStyles` 里 ✓）。
    expect((globalStyles.match(/transition-all/g) || []).length).toBe(0);
    // 并钉住「不再有那个手搓类」✓ —— 否则上一条在「类名被改坏」时也会假绿 ✗。
    expect(globalStyles).not.toMatch(/\.toggle-knob\s*\{/);
  });
});
