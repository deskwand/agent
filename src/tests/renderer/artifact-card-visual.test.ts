// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ArtifactCard } from "../../renderer/components/message/ArtifactCard";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import type { ResultFileEntry } from "../../renderer/utils/tool-display-blocks";
import {
  globalToken,
  paddingYRem,
  rootPx,
  spacingRem,
  tailwind,
  textSizeRem,
} from "./theme-css-helpers";

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));

const editedFile: ResultFileEntry = {
  path: "src/example.ts",
  edits: 1,
  writes: 0,
  addedLines: 5,
  removedLines: 2,
};

const newFile: ResultFileEntry = {
  path: "src/new-file.ts",
  edits: 0,
  writes: 1,
  addedLines: 10,
  removedLines: 0,
};

const imageFile: ResultFileEntry = {
  path: "assets/preview.png",
  edits: 0,
  writes: 1,
  addedLines: 0,
  removedLines: 0,
};

function makeSession(): Session {
  return {
    id: "session-1",
    title: "Artifact visual test",
    status: "idle",
    cwd: "/repo",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function findFileCards(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[role="button"]'),
  ) as HTMLElement[];
}

describe("ArtifactCard visual hierarchy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({
      activeSessionId: "session-1",
      sessions: [makeSession()],
    });
    window.electronAPI = {
      git: {
        hasChanges: vi.fn(async () => ({ isRepo: true, changeCount: 3 })),
      },
    } as unknown as typeof window.electronAPI;

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  async function render(files: ResultFileEntry[]): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(ArtifactCard, {
          files,
          videoReferences: [],
          isLatestRound: true,
        }),
      );
      await Promise.resolve();
    });
  }

  it("renders each file as a separate card", async () => {
    await render([editedFile, newFile, imageFile]);

    const cards = findFileCards(container);
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain("src/example.ts");
    expect(cards[1].textContent).toContain("src/new-file.ts");
    expect(cards[2].textContent).toContain("assets/preview.png");
  });

  it("renders cards with rounded-xl border style", async () => {
    await render([editedFile]);

    const cards = findFileCards(container);
    expect(cards).toHaveLength(1);
    const cardEl = cards[0].closest(".rounded-xl");
    expect(cardEl).not.toBeNull();
    expect(cardEl?.classList.contains("border-border/40")).toBe(true);
  });

  it("shows file extension badges instead of paperclip/file icons", async () => {
    await render([editedFile, imageFile]);

    // No more Paperclip icon (used for old title)
    expect(container.querySelector(".lucide-paperclip")).toBeNull();
    // No more generic File icon
    expect(container.querySelector(".lucide-file")).toBeNull();
    // Has file extension text labels
    expect(container.textContent).toContain("TS");
    expect(container.textContent).toContain("PNG");
  });

  it("shows revert button always visible for latest round", async () => {
    await render([editedFile]);

    const revertBtn = Array.from(container.querySelectorAll("button")).find(
      (el) => {
        const text = el.textContent || "";
        return text.includes("撤销") || text === "Revert";
      },
    );
    expect(revertBtn).toBeDefined();
    // Should be visible, not opacity-0
    expect(revertBtn?.classList.contains("opacity-0")).toBe(false);
  });

  it("shows edit status and change count", async () => {
    await render([editedFile]);

    expect(container.textContent).toMatch(/编辑|Edited/);
    expect(container.textContent).toContain("+5");
  });

  it("shows new status and change count for new files", async () => {
    await render([newFile]);

    expect(container.textContent).toMatch(/新建|New/);
    expect(container.textContent).toContain("+10");
    expect(container.textContent).toContain("-0");
  });

  it("renders in a flex column layout", async () => {
    await render([editedFile, newFile]);

    // The wrapper should be a flex column for card stacking
    const wrapper = container.firstElementChild;
    expect(wrapper?.classList.contains("flex-col")).toBe(true);
  });

  it("does not show group labels or round title", async () => {
    await render([editedFile, newFile]);

    expect(container.textContent).not.toMatch(/本轮产物|Round Artifacts/);
    expect(container.textContent).not.toMatch(/编辑的文件|Edited Files/);
    expect(container.textContent).not.toMatch(/新建的文件|New Files/);
    expect(container.textContent).not.toMatch(/Videos|视频/);
  });

  it("does not show round revert button at bottom", async () => {
    await render([editedFile]);

    const buttons = Array.from(container.querySelectorAll("button"));
    const roundRevert = buttons.find(
      (el) =>
        el.textContent?.includes("撤销本轮") ||
        el.textContent?.includes("Revert Round"),
    );
    expect(roundRevert).toBeUndefined();
  });
});

/**
 * 紧凑档的守卫（2026-10-10 用户报障「这个产物卡片就太大了，字体也太大了吧」）。
 *
 * 阈值一律从 tailwind.config.js / globals.css 算，不把 px 写死在断言里：唯一的常数是
 * `ICON_KEY_PX`（仓库图标键的既有尺寸）与上界 56px（定稿那一档的高度，见
 * `design-docs/mockups/2026-10-10-artifact-card-compact.html`）。
 */
describe("ArtifactCard compact scale", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({
      activeSessionId: "session-1",
      sessions: [makeSession()],
    });
    window.electronAPI = {
      git: {
        hasChanges: vi.fn(async () => ({ isRepo: true, changeCount: 3 })),
      },
    } as unknown as typeof window.electronAPI;

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  async function renderRow(): Promise<{
    row: HTMLElement;
    badge: HTMLElement;
    name: HTMLElement;
    meta: HTMLElement;
  }> {
    await act(async () => {
      root.render(
        React.createElement(ArtifactCard, {
          files: [editedFile],
          videoReferences: [],
          isLatestRound: true,
        }),
      );
      await Promise.resolve();
    });
    const row = findFileCards(container)[0];
    const pick = (selector: string, what: string): HTMLElement => {
      const el = row.querySelector(selector);
      if (!el) throw new Error(`行里找不到${what}：${selector}`);
      return el as HTMLElement;
    };
    return {
      row,
      badge: pick("div.bg-muted", "扩展名方块"),
      name: pick("div.truncate", "文件名"),
      meta: pick("div.text-xs", "统计行"),
    };
  }

  /** `h-7` / `w-7` → 28（px）。 */
  function boxPx(cls: string, axis: "h" | "w"): number {
    const m = new RegExp(`(?:^|\\s)${axis}-([\\d.]+)(?:\\s|$)`).exec(cls);
    if (!m) throw new Error(`未找到 ${axis}-* 类：${cls}`);
    return Number(m[1]) * spacingRem() * rootPx();
  }

  /** `mt-0.5` → 2（px）。 */
  function marginTopPx(cls: string): number {
    const m = /(?:^|\s)mt-([\d.]+)(?:\s|$)/.exec(cls);
    if (!m) throw new Error(`未找到 mt-* 类：${cls}`);
    return Number(m[1]) * spacingRem() * rootPx();
  }

  /** `text-sm` 的行高（px）—— 同样从 tailwind.config.js 的 fontSize 表读。 */
  function lineHeightPx(cls: string): number {
    const m = /(?:^|\s)text-(xs|sm|base|lg|xl|2xl)(?:\s|$)/.exec(cls);
    if (!m) throw new Error(`未找到 text-<size> 类：${cls}`);
    return (
      parseFloat(tailwind.theme.extend.fontSize[m[1]][1].lineHeight) * rootPx()
    );
  }

  /**
   * 方块标签的字号 → px（`text-[…rem]` 按根字号归一，命名的 token 查 tailwind 表）。
   * 写死 px 的形式**不算** —— 那是「不跟随设置 → 字号」的那个写法，下面单独拒。
   */
  function badgeLabelPx(cls: string): number | null {
    const rem = /text-\[([\d.]+)rem\]/.exec(cls);
    if (rem) return Number(rem[1]) * rootPx();
    const token = /(?:^|\s)text-([a-z0-9]+)(?=\s|$)/.exec(cls);
    const size = token ? tailwind.theme.extend.fontSize[token[1]] : undefined;
    return size ? parseFloat(size[0]) * rootPx() : null;
  }

  /** 按钮在行内的高度（px）：上下内边距 + 内容（文字行高，或图标尺寸）+ 上下边框。 */
  function buttonHeightPx(button: HTMLElement): number {
    const cls = button.className;
    const pad =
      /(?:^|\s)py-([\d.]+)(?:\s|$)/.exec(cls) ??
      /(?:^|\s)p-([\d.]+)(?:\s|$)/.exec(cls);
    const padY = pad ? Number(pad[1]) * spacingRem() * rootPx() : 0;

    let content = 0;
    if (/(?:^|\s)text-(xs|sm|base|lg|xl|2xl)(?:\s|$)/.test(cls)) {
      content = lineHeightPx(cls);
    } else {
      const iconClass =
        button.querySelector("svg")?.getAttribute("class") ?? "";
      const iconH = /(?:^|\s)h-([\d.]+)(?:\s|$)/.exec(iconClass);
      content = iconH ? Number(iconH[1]) * spacingRem() * rootPx() : 0;
    }
    return padY * 2 + content + (button.classList.contains("border") ? 2 : 0);
  }

  /**
   * 行高 = 上下内边距 + 上下 1px 边框 + 内容（扩展名方块 / 两行文字 / 操作列按钮 三者的较大者）。
   * 同时返回驱动者，断言挂了能一眼看出是谁变高了。
   */
  function rowHeightPx(
    row: HTMLElement,
    badge: HTMLElement,
    name: HTMLElement,
    meta: HTMLElement,
  ): { height: number; driver: string } {
    const text =
      lineHeightPx(name.className) +
      marginTopPx(meta.className) +
      lineHeightPx(meta.className);
    const buttons = Array.from(row.querySelectorAll("button"));
    const candidates: Array<[string, number]> = [
      ["扩展名方块", boxPx(badge.className, "h")],
      ["文件名 + 统计行", text],
      ...buttons.map((b, i): [string, number] => [
        `操作列第 ${i + 1} 个按钮`,
        buttonHeightPx(b),
      ]),
    ];
    const [driver, content] = candidates.reduce((best, c) =>
      c[1] > best[1] ? c : best,
    );
    return {
      height: 2 * paddingYRem(row.className) * rootPx() + 2 + content,
      driver,
    };
  }

  it("行标题字号不得超过聊天正文（「字体太大」的根因）", async () => {
    const { name } = await renderRow();
    const rowTitle = textSizeRem(name.className) * rootPx();
    const chatBody = parseFloat(globalToken("--font-size-chat")) * rootPx();

    // 修复前是 text-base（16px）压正文（14px）—— 产物行比它所在的消息还醒目。
    expect(
      rowTitle,
      `行标题 ${rowTitle}px / 正文 ${chatBody}px`,
    ).toBeLessThanOrEqual(chatBody);
  });

  it("单行高度不超过 56px（四行仍留在 max-h-[320px] 以内）", async () => {
    const { row, badge, name, meta } = await renderRow();

    // 高度公式假定行高来自 `text-<size>` 自带的 lineHeight；再写 `leading-*` 覆盖就失真了
    //（同目录的 ResultSummaryBlock 就写了 leading-[var(--line-height-chat)]）。
    for (const [label, cls] of [
      ["文件名", name.className],
      ["统计行", meta.className],
    ]) {
      expect(cls, `${label}多写了 leading-* 覆盖`).not.toMatch(
        /(?:^|\s)leading-/,
      );
    }

    const { height, driver } = rowHeightPx(row, badge, name, meta);
    // 56px 是定稿那一档的高度；修复前是 72px（四行 312px 直接顶到滚动线）。
    expect(height, `行高由「${driver}」决定`).toBeLessThanOrEqual(56);
  });

  it("扩展名方块不大于图标键，且标签字号不超过 10px", async () => {
    const { badge } = await renderRow();

    // 28px = 仓库图标键的既有尺寸（app-button 的 `iconSm` 档、BrowserPanel / TitlebarButton
    // 就地写的 `w-7 h-7`）。再大就会把行高顶回去。
    const ICON_KEY_PX = 28;
    expect(boxPx(badge.className, "h")).toBeLessThanOrEqual(ICON_KEY_PX);
    expect(boxPx(badge.className, "w")).toBeLessThanOrEqual(ICON_KEY_PX);

    // 方块变小后，标签字号必须跟着降 —— 否则 4 字符的扩展名（HTML / TSX）会撑破方块；
    // 同时不许写死 px：App.tsx 把「设置 → 字号」做成根字号上的 `--ui-font-scale`，
    // 只有 rem（或命名 token）会跟着缩放，而方块自身是 h-7/w-7（rem）。
    expect(
      badge.className,
      "方块标签写死了 px，不会跟随「设置 → 字号」",
    ).not.toMatch(/text-\[[\d.]+px\]/);
    const labelPx = badgeLabelPx(badge.className);
    expect(
      labelPx,
      `方块标签既不是 text-[…rem] 也不是命名 token：${badge.className}`,
    ).not.toBeNull();
    expect(labelPx as number).toBeLessThanOrEqual(10);

    // 4 字符最坏情况（MAKE / DOCK）大约 28.6px 而方块宽 28px ⇒ 必须有东西兜住溢出。
    expect(badge.className).toMatch(/(?:^|\s)overflow-hidden(?:\s|$)/);
  });

  it("视频行的缩略图与名称跟文件行同档", async () => {
    const video = {
      path: "/repo/clips/demo.mp4",
      name: "demo.mp4",
      playbackKind: "external" as const,
    };
    await act(async () => {
      root.render(
        React.createElement(ArtifactCard, {
          files: [],
          videoReferences: [video],
          isLatestRound: true,
        }),
      );
      await Promise.resolve();
    });

    const thumb = container.querySelector("div.bg-muted") as HTMLElement;
    const name = container.querySelector("div.truncate") as HTMLElement;
    expect(thumb, "找不到视频缩略图").not.toBeNull();
    expect(name, "找不到视频名称").not.toBeNull();

    // 同一条口径：缩略图不得超过图标键（28²），名称不得超过正文。
    expect(boxPx(thumb.className, "h")).toBeLessThanOrEqual(28);
    expect(textSizeRem(name.className) * rootPx()).toBeLessThanOrEqual(
      parseFloat(globalToken("--font-size-chat")) * rootPx(),
    );
  });
});
