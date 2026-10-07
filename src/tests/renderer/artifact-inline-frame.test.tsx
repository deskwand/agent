// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { ArtifactInlineFrame } from "../../renderer/components/message/ArtifactInlineFrame";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

function makeSession(): Session {
  return {
    id: "s1",
    title: "Inline artifact test",
    status: "idle",
    cwd: "/workspace-root",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const getRenderUrl = vi.hoisted(() => vi.fn());
const openInBrowser = vi.hoisted(() => vi.fn());

vi.mock("../../renderer/utils/open-in-browser", () => ({
  openFilePathInBrowser: openInBrowser,
  openBrowserPanel: vi.fn(),
}));

const ARTIFACT = { path: "/w/report.html", name: "report.html" };

describe("ArtifactInlineFrame", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getRenderUrl.mockReset();
    openInBrowser.mockReset();
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({ activeSessionId: "s1", sessions: [makeSession()] });
    (globalThis as unknown as { window: Window }).window.electronAPI = {
      artifact: { getRenderUrl },
    } as unknown as typeof window.electronAPI;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders no iframe while folded", () => {
    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={false}
          onToggle={() => {}}
        />,
      );
    });
    expect(container.querySelector("iframe")).toBeNull();
    expect(getRenderUrl).not.toHaveBeenCalled();
  });

  it("renders a sandboxed iframe when expanded", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toContain("deskwand-artifact://");
  });

  it("展开后只变一次高度：骨架屏是覆盖层，容器先占住成品高度", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });

    const body = container.querySelector(
      '[data-testid="artifact-inline-body"]',
    );
    // onLoad 之前就要占住与 iframe 等高的位置：不然 onLoad 时骨架屏撤掉会掉 100px
    expect(body?.className).toContain("min-h-[320px]");

    const skeleton = container.querySelector(
      '[data-testid="artifact-inline-skeleton"]',
    );
    // 骨架屏必须脱离布局（盖在 iframe 上）。与 iframe 并存时内容高 448px，
    // 被 max-h-[420px] 裁一次、onLoad 后再掉回 320 —— 展开后还能看见两次跳高
    expect(skeleton?.className).toContain("absolute");

    // iframe 必须仍然挂载：改成「骨架替换 iframe」就永远不会触发 onLoad
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("折叠态与展开态的头部是同一档高度，切换时这一行不跳", () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={false}
          onToggle={() => {}}
        />,
      );
    });
    expect(container.querySelector("button")?.className).toContain("min-h-9");

    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
    });
    expect(container.querySelector(".border-b")?.className).toContain(
      "min-h-9",
    );
  });

  it("shows the failure row when no url can be minted", async () => {
    getRenderUrl.mockResolvedValue(null);
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-inline-failed"]'),
    ).not.toBeNull();
  });

  it("re-mints the url when it is expanded after being folded", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={false}
          onToggle={() => {}}
        />,
      );
    });
    expect(getRenderUrl).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    expect(getRenderUrl).toHaveBeenCalledTimes(1);
  });

  it("opens the file in the browser panel", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    const button = container.querySelector(
      `button[aria-label="${i18n.t("artifact.inline.openInBrowser")}"]`,
    );
    act(() => (button as HTMLButtonElement).click());
    expect(openInBrowser).toHaveBeenCalledWith("/w/report.html");
  });

  it("asks the parent to toggle", () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={false}
          onToggle={onToggle}
        />,
      );
    });
    act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(onToggle).toHaveBeenCalledWith("/w/report.html");
  });

  // 模型给的是相对工作区的路径（仓库自己的 <file_references> 规则要求如此），
  // 而主进程的 cwd 是应用启动时的目录（打包后从 Dock 启动就是 `/`）。
  // 不解析就是 stat(ENOENT) → null → 失败行。
  it("resolves a workspace-relative path before asking for a render url", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={{ path: "out/report.html", name: "report.html" }}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    expect(getRenderUrl).toHaveBeenCalledWith(
      "/workspace-root/out/report.html",
    );
  });

  it("opens the resolved path in the browser panel", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={{ path: "out/report.html", name: "report.html" }}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    const button = container.querySelector(
      `button[aria-label="${i18n.t("artifact.inline.openInBrowser")}"]`,
    );
    act(() => (button as HTMLButtonElement).click());
    expect(openInBrowser).toHaveBeenCalledWith(
      "/workspace-root/out/report.html",
    );
  });
});
