// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AccountMenu } from "../src/renderer/components/AccountMenu";
import { ChatInputStatusBar } from "../src/renderer/components/ChatInputStatusBar";
import { FilePreviewModal } from "../src/renderer/components/FilePreviewModal";
import { GlobalNoticeToast } from "../src/renderer/components/GlobalNoticeToast";
import { LoginModal } from "../src/renderer/components/LoginModal";
import { SandboxSyncToast } from "../src/renderer/components/SandboxSyncToast";

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
    act(() => {
      root.render(
        createElement(FilePreviewModal, {
          isOpen: true,
          filePath: "/tmp/example.txt",
          fileName: "example.txt",
          onClose: () => undefined,
        }),
      );
    });

    const overlay = container.firstElementChild;
    const card = overlay?.firstElementChild;
    expect(overlay?.classList.contains("bg-black/40")).toBe(true);
    expect(overlay?.classList.contains("modal-overlay")).toBe(false);
    expect(overlay?.classList.contains("animate-fade-in")).toBe(false);
    expect(card?.classList.contains("animate-slide-up")).toBe(false);
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

  it("anchors the account menu entrance to its trigger", () => {
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

    expect(container.querySelector(".animate-account-menu-in")).not.toBeNull();
  });

  it("defines scoped reduced-motion fallbacks without hover zoom", () => {
    expect(globalStyles).toContain("--motion-fast: 150ms;");
    expect(globalStyles).toContain("--motion-standard: 200ms;");
    expect(globalStyles).toContain(
      "--ease-ui-out: cubic-bezier(0.23, 1, 0.32, 1);",
    );
    expect(globalStyles).toContain("@keyframes account-menu-in");
    expect(globalStyles).not.toContain("@keyframes eff-message-in");
    expect(globalStyles).not.toContain("@keyframes eff-float");
    expect(globalStyles).not.toContain(".eff-message-enter");
    expect(globalStyles).not.toContain(".eff-float");
    expect(globalStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.animate-slide-up,[\s\S]*\.animate-toast-in-top,[\s\S]*\.animate-toast-in-bottom,[\s\S]*\.animate-account-menu-in[\s\S]*animation-name: fade-in !important;/,
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
    expect(globalStyles).not.toContain("transition-all");
  });
});
