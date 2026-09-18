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
  });

  it("renders modal entrance classes on the final DOM", () => {
    act(() => {
      root.render(
        createElement(LoginModal, {
          isOpen: true,
          onClose: () => undefined,
          onLoginSuccess: () => undefined,
        }),
      );
    });

    const overlay = container.firstElementChild;
    const card = overlay?.firstElementChild;
    expect(overlay?.classList.contains("modal-overlay")).toBe(true);
    expect(overlay?.classList.contains("animate-fade-in")).toBe(true);
    expect(card?.classList.contains("animate-slide-up")).toBe(true);
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
    act(() => {
      root.render(
        createElement(AccountMenu, {
          isOpen: true,
          cloudConfig: null,
          onOpenLogin: () => undefined,
          onOpenSettings: () => undefined,
          onOpenAutomation: () => undefined,
          onOpenMarketplace: () => undefined,
          onLogout: () => undefined,
          onClose: () => undefined,
        }),
      );
    });

    expect(container.querySelector(".animate-menu-in-up")).not.toBeNull();
  });

  it("defines scoped reduced-motion fallbacks without hover zoom", () => {
    expect(globalStyles).toContain("--motion-fast: 150ms;");
    expect(globalStyles).toContain("--motion-standard: 200ms;");
    expect(globalStyles).toContain(
      "--ease-ui-out: cubic-bezier(0.23, 1, 0.32, 1);",
    );
    expect(globalStyles).toContain("@keyframes menu-in-up");
    expect(globalStyles).toContain("@keyframes menu-in-down");
    expect(globalStyles).not.toContain("@keyframes eff-message-in");
    expect(globalStyles).not.toContain("@keyframes eff-float");
    expect(globalStyles).not.toContain(".eff-message-enter");
    expect(globalStyles).not.toContain(".eff-float");
    expect(globalStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.animate-slide-up,[\s\S]*\.animate-toast-in-top,[\s\S]*\.animate-toast-in-bottom,[\s\S]*\.animate-menu-in-up,[\s\S]*\.animate-menu-in-down[\s\S]*animation-name: fade-in !important;/,
    );
    expect(globalStyles).toMatch(
      /\.btn:hover\s*\{\s*box-shadow:\s*var\(--shadow-elevated\);\s*\}/,
    );
    expect(globalStyles).toContain(
      "@apply transition-[border-color,box-shadow,background-color,color] duration-150;",
    );
    expect(globalStyles).toContain(
      "transition-[background-color,box-shadow,color] duration-150",
    );
    // transition-all is allowed exactly once, scoped to the toggle-knob
    // switch animation (left-position slide needs it); everything else
    // must use scoped transition properties.
    expect((globalStyles.match(/transition-all/g) || []).length).toBe(1);
    expect(globalStyles).toMatch(/\.toggle-knob\s*\{[\s\S]*?transition-all/);
  });
});
