// @vitest-environment jsdom
//
// 插件页（连接 → 插件）的界面契约：
//   - 「市场 / 已安装」是 Radix ToggleGroup 分段选择（role=radiogroup + 可访问名），
//     `type="single"` 的 onValueChange 空串不得把视图切走；
//   - 市场行用 shadcn 条目惯例表达选中（data-selected + accent 底色），
//     不再有自造的左侧竖条。
// 只 stub 服务（piExtensions.listState / piMarket.search），不 mock 原语。
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { PiExtensionManagerView } from "../../renderer/components/PiExtensionManagerView";

const PACKAGES = [
  { name: "pi-mcp-adapter", type: "extension", version: "5.2.0" },
  { name: "billion-context", type: "package", version: "2.0.0" },
];

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("plugins view (market / installed)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    window.electronAPI = {
      piExtensions: {
        listState: vi.fn(async () => ({
          sdkVersion: "1.0.50",
          packages: [],
          extensions: [],
          errors: [],
        })),
      },
      piMarket: {
        search: vi.fn(async () => ({
          objects: PACKAGES,
          total: PACKAGES.length,
        })),
        // 右栏详情会再拉一次详情与下载量；不 stub 会在渲染期抛未处理的 Promise
        detail: vi.fn(async (name: string) => ({
          name,
          type: "extension",
          version: "5.2.0",
          description: "MCP adapter",
          downloads: 1608890,
        })),
        download: vi.fn(async () => 1608890),
      },
      on: vi.fn(() => () => {}),
    } as unknown as typeof window.electronAPI;
  });

  const render = async () => {
    await act(async () => {
      root.render(React.createElement(PiExtensionManagerView));
    });
    await flush();
  };

  const radios = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]'));

  it("分段选择是原生 radiogroup，可访问名走 i18n", async () => {
    await render();
    const group = container.querySelector('[role="radiogroup"]');
    expect(group, "市场/已安装必须是 radiogroup").not.toBeNull();
    expect(group!.getAttribute("aria-label")).toBe(
      i18n.t("piExtensions.viewSwitcher"),
    );
    expect(radios().map((r) => r.textContent?.trim())).toEqual([
      i18n.t("piExtensions.viewMarket"),
      i18n.t("piExtensions.viewInstalled"),
    ]);
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("点击「已安装」切换视图，市场列表让位", async () => {
    await render();
    expect(container.textContent).toContain("pi-mcp-adapter");
    await act(async () => {
      radios()[1].click();
    });
    await flush();
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    expect(radios()[0].getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).not.toContain("pi-mcp-adapter");
  });

  it("市场行用 shadcn 条目惯例表达选中，没有自造左竖条", async () => {
    await render();
    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>("ul li > button"),
    );
    expect(rows.length).toBeGreaterThan(0);
    // 第一行会被自动选中（列表加载完成后默认选第一个）
    expect(rows[0].getAttribute("data-selected")).toBe("true");
    expect(rows[0].className).toContain("data-[selected=true]:bg-accent");
    expect(rows[0].className).not.toContain("border-l-2");
    expect(rows[0].className).not.toContain("bg-primary/10");
    expect(rows[1].getAttribute("data-selected")).toBe("false");
  });
});
