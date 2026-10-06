// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsAbout } from "../../renderer/components/settings/SettingsAbout";
import type { ServerEvent } from "../../renderer/types";

let container: HTMLDivElement;
let root: Root;
let send: ReturnType<typeof vi.fn>;
let openExternal: ReturnType<typeof vi.fn>;
/** 组件用 window.electronAPI.on 订阅主进程事件；把 handler 存下来精确投递。 */
let emit: (event: ServerEvent) => void;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  send = vi.fn();
  openExternal = vi.fn().mockResolvedValue(true);
  window.electronAPI = {
    send,
    openExternal,
    on: (handler: (event: ServerEvent) => void) => {
      emit = handler;
      return () => {};
    },
  } as never;

  // 组件文案走 i18n。强制中文 —— jsdom 的 navigator.language 是 en-US，
  // 不强制的话断言会拿到英文。
  const i18n = (await import("../../renderer/i18n/config")).default;
  await i18n.changeLanguage("zh");

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { electronAPI?: unknown }).electronAPI;
  vi.unstubAllGlobals();
});

describe("设置 →「关于」页", () => {
  it("页面根元素不居中，与其它设置页同一条左边缘", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    const rootEl = container.firstElementChild as HTMLElement;
    expect(rootEl.className).toContain("space-y-6");
    // 回归守卫：这页原本整块水平居中（flex flex-col items-center），与页头
    // 「关于」的左边缘错开半列宽。断言必须落在根元素自身 —— 品牌头内部合法
    // 地用到 items-center，用 querySelector(".items-center") 会永远红。
    expect(rootEl.className).not.toContain("items-center");

    // 窄窗（<900px）不溢出的保证是「按钮 flex-none + 文字列 min-w-0 flex-1」。
    // jsdom 量不出布局，只能把这对 class 钉住，给这条不变量留一个自动痕迹。
    expect(rootEl.querySelector(".flex-none")).not.toBeNull();
    expect(rootEl.querySelector(".min-w-0.flex-1")).not.toBeNull();
  });

  it("品牌头渲染图标、名称与版本号", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    expect(container.querySelector('img[alt="DeskWand"]')).not.toBeNull();

    // 名称必须单独断言：只看 textContent 抓不到删掉名称的回归 —— 小节标题
    // 是「关于 DeskWand」，本来就含 "DeskWand"，名称没了也照样包含。
    const brandName = [...container.querySelectorAll("div")].find(
      (element) => element.textContent?.trim() === "DeskWand",
    );
    expect(brandName).toBeDefined();

    expect(container.textContent).toContain("v1.0.47");
  });

  it("按钮跟着更新状态走，重新检查也能再次发起", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);
    expect(buttonByText("检查更新")).toBeDefined();

    await act(async () => {
      emit({ type: "update.not-available", payload: {} });
    });
    expect(buttonByText("重新检查")).toBeDefined();

    // error 与 up-to-date 共用同一个按钮，spec §5 把这条分支列为不变量
    await act(async () => {
      emit({ type: "update.error", payload: { message: "boom" } });
    });
    const recheck = buttonByText("重新检查");
    expect(recheck).toBeDefined();

    await act(async () => {
      recheck?.click();
    });
    expect(send).toHaveBeenCalledWith({ type: "update.check", payload: {} });

    await act(async () => {
      emit({
        type: "update.downloaded",
        payload: { version: "1.0.48", releaseNotes: null },
      });
    });
    expect(buttonByText("立即重启")).toBeDefined();
  });

  it("点「检查更新」发出 update.check", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    await act(async () => {
      buttonByText("检查更新")?.click();
    });

    expect(send).toHaveBeenCalledWith({ type: "update.check", payload: {} });
  });

  it("下载中显示进度条，aria-valuenow 是四舍五入后的百分比", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    await act(async () => {
      emit({
        type: "update.progress",
        payload: {
          percent: 42.6,
          bytesPerSecond: 0,
          transferred: 0,
          total: 0,
        },
      });
    });

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-valuenow")).toBe("43");
  });

  it("更新失败时在状态槽显示错误详情", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    await act(async () => {
      emit({
        type: "update.error",
        payload: { message: "ERR_INTERNET_DISCONNECTED" },
      });
    });

    expect(container.textContent).toContain("ERR_INTERNET_DISCONNECTED");
  });

  it("渲染产品介绍：一段介绍 + 6 条特性（中文）", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    expect(container.textContent).toContain(
      "基于 Pi Agent SDK 构建的桌面 AI Agent。",
    );

    for (const text of [
      "目标驱动",
      "给出目标，Agent 自动规划并执行",
      "子 Agent",
      "复杂任务拆分给专业 Agent，并行协作",
      "桌面原生",
      "直接操作本地文件、项目和开发环境",
      "Agent 原生 Office",
      "直接写出真正的 Word、Excel、PPT 文件",
      "自进化技能",
      "成功执行的任务转化为可复用技能",
      "多模型支持",
      "自由选择最适合你的 AI 模型",
    ]) {
      expect(container.textContent).toContain(text);
    }

    // 结构断言：特性必须落在一张 SettingsCard 里、恰好 6 行。只查文字串的话，
    // 6 个 <p> 或重复的行也能通过。rounded-container 是 SettingsCard 独有的
    // class（shared.tsx:136），本页其余地方只用 rounded-md / lg / full，
    // 所以这个选择器唯一。
    const cards = container.querySelectorAll(".rounded-container");
    expect(cards.length).toBe(1);
    expect(cards[0].children.length).toBe(6);
  });

  it("英文语言下同样取到文案，且不泄漏 i18n 原始键", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    const i18n = (await import("../../renderer/i18n/config")).default;
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(container.textContent).toContain("Goal-driven agents");

    // 泄漏检测：config.ts 的 parseMissingKeyHandler 返回 defaultValue ?? key，
    // 而本页调用点都不传 default —— 中文和英文都缺的键会原样渲染成
    // about.features.foo。这是本页唯一能盖住这个盲区的断言：
    //   - locale-parity 只比 zh↔en 的键集，两边都缺它看不到；
    //   - renderer-i18n-keys 只查「代码里有字面 t("key")、语言包没有」的反方向，
    //     而本页 16 个键走的是 t(feature.titleKey) 这种「存在数据表里再传给 t()」
    //     的写法，正是它注释里成文承认的已知盲区。
    // 这里不加 \b：若被泄漏的 key 前面紧邻字母（如 "DeskWandabout.features.x"），
    // \b 会匹配不到而漏报。
    expect(container.textContent ?? "").not.toMatch(/about\.[a-zA-Z]/);
  });

  it("六个链接逐个用正确的 URL 调 openExternal", async () => {
    await render(<SettingsAbout appVersion="1.0.47" />);

    for (const [label, url] of [
      ["官网", "https://deskwand.com"],
      ["GitHub 仓库", "https://github.com/deskwand/agent"],
      ["更新日志", "https://github.com/deskwand/agent/releases"],
      ["MIT 开源协议", "https://github.com/deskwand/agent/blob/main/LICENSE"],
      // 2026-10-06：图标栏的「?」在有更新时会让位给升级按钮，菜单进不去。
      // 这两条是那段时间里手册与反馈的唯一入口（见 rail-update-icon-design §5）。
      ["使用手册", "https://www.deskwand.com/manual"],
      ["反馈问题", "https://github.com/deskwand/agent/issues"],
    ] as const) {
      openExternal.mockClear();
      await act(async () => {
        buttonByText(label)?.click();
      });
      expect(openExternal, label).toHaveBeenCalledWith(url);
    }
  });
});
