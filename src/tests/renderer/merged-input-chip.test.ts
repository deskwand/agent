// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergedInputChip } from "../../renderer/components/MergedInputChip";
import type { ModelOptionGroup } from "../../renderer/components/ChatInputBottomBar";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modelOptions: ModelOptionGroup[] = [
  {
    profileKey: "custom:deskwand" as never,
    groupLabel: "DeskWand",
    items: [
      { id: "deepseek-flash", name: "deepseek-flash" },
      { id: "deepseek-v4-pro", name: "deepseek-v4-pro" },
    ],
  },
  {
    profileKey: "profile-a" as never,
    groupLabel: "Provider A",
    items: [
      { id: "model-1", name: "Model One" },
      { id: "model-2", name: "Model Two" },
    ],
  },
  {
    profileKey: "profile-b" as never,
    groupLabel: "Provider B",
    items: [{ id: "model-3", name: "Model Three" }],
  },
];

// 单分组长列表：搜索框判据只看模型总数，用单分组避免与分组标题判据相互干扰。
function singleGroupOptions(count: number): ModelOptionGroup[] {
  return [
    {
      profileKey: "profile-a" as never,
      groupLabel: "Provider A",
      items: Array.from({ length: count }, (_, i) => ({
        id: `model-${i}`,
        name: `Model ${i}`,
      })),
    },
  ];
}

const thinkingLevelOptions = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as never[];

const baseProps = {
  model: "model-1",
  modelOptions,
  activeProviderProfileKey: "profile-a" as never,
  onSelectModel: vi.fn(),
  modelMenuDisabled: false,
  thinkingLevel: "medium" as never,
  thinkingLevelOptions,
  onSelectThinkingLevel: vi.fn(),
};

function loginCloud() {
  useAppStore.getState().setCloudConfig({
    serverUrl: "",
    token: "",
    isLoggedIn: true,
    email: "a@b.com",
    level: "default",
    balanceMicroUsd: 100,
  });
}

describe("MergedInputChip (single-panel)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
    vi.clearAllMocks();
    useAppStore.getState().setCloudConfig(null);
  });

  function render(props = {}) {
    act(() => {
      root.render(
        React.createElement(MergedInputChip, { ...baseProps, ...props }),
      );
    });
  }

  // 触发器：迁移前手写 aria-haspopup="menu"，迁到 Radix 的 Popover 后由 PopoverTrigger
  // 写 aria-haspopup="dialog" —— 判据只取「有 aria-haspopup」，迁移前后都成立。
  function trigger(): HTMLButtonElement {
    return container.querySelector("button[aria-haspopup]")!;
  }

  function isPanelOpen(): boolean {
    return trigger().getAttribute("aria-expanded") === "true";
  }

  // Radix 在 setTimeout(0) 里挂 document 级 pointerdown 监听、Presence 也延后一帧，
  // 需要这类行为生效时先推一个宏任务。
  async function flushMacrotask() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  // 打开必须条件式：PopoverTrigger 只认 click，DropdownMenuTrigger 只认 pointerdown。
  // 不能一次派发两个事件 —— 第二个会被第一个的后果消费，Radix 打开后那发 click
  // 落在内容之外，会被当成外部点击把面板立刻关掉。
  async function openPanel() {
    act(() => {
      trigger().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    if (!isPanelOpen()) click(trigger());
    await flushMacrotask();
  }

  // 点外部同样条件式，「先 pointerdown、没关再补 click、仍没关再补 mousedown」：
  // Radix 的 DismissableLayer 靠 document 级 pointerdown，而 Popover 的
  // deferPointerDownOutside 要等随后那发 click 才真正关闭；旧实现只听 mousedown。
  async function clickOutside() {
    act(() => {
      document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    for (const type of ["click", "mousedown"] as const) {
      if (!isPanelOpen()) break;
      act(() => {
        document.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      });
    }
    await flushMacrotask();
  }

  // 面板经 portal 挂到 document.body（触发器仍在 container 里）—— 面板与触发器分开查。

  it("keeps an end-aligned menu inside the viewport near its left edge", async () => {
    stubLayout({ triggerTop: 300, triggerRight: 260 });
    render();
    await openPanel();
    expect(panel().style.maxWidth).toBe("252px");
  });

  // jsdom 没有布局，手动给出触发器与面板的坐标，模拟 WelcomeView 中输入框垂直居中、
  // 面板上方空间不足的场景（真实修复前的值可参考菜单高度 ≈ 100vh - 12rem）。
  // panelBottom 默认给 Radix 定位完成前的那一帧：wrapper 带着 translate(0, -200%)，
  // 面板整个落在视口上方，getBoundingClientRect 的 bottom 是负的。
  function stubLayout({
    triggerTop,
    triggerRight = 500,
    panelBottom = triggerTop - 512,
  }: {
    triggerTop: number;
    triggerRight?: number;
    panelBottom?: number;
  }) {
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute?.("aria-haspopup")) {
        return {
          top: triggerTop,
          bottom: triggerTop + 36,
          left: 0,
          right: triggerRight,
          width: 0,
          height: 36,
          x: 0,
          y: triggerTop,
          toJSON: () => ({}),
        } as DOMRect;
      }
      const role = this.getAttribute?.("role");
      if (role === "menu" || role === "dialog") {
        return {
          top: panelBottom - 100,
          bottom: panelBottom,
          left: 0,
          right: 0,
          width: 0,
          height: 100,
          x: 0,
          y: panelBottom - 100,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return realGetBoundingClientRect.call(this);
    };
  }

  function panel(): HTMLElement {
    return document.body.querySelector('[role="menu"], [role="dialog"]')!;
  }

  function click(el: Element | undefined) {
    if (!el) throw new Error("element not found");
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function setSearchValue(value: string) {
    const input = panel().querySelector("input");
    if (!input) throw new Error("search input not found");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  // 分组标题按钮：文本就是组名（chevron 是 svg，不贡献 textContent）
  function groupHeader(label: string): HTMLButtonElement {
    const found = Array.from(panel().querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`group header not found: ${label}`);
    return found as HTMLButtonElement;
  }

  it("renders one trigger chip with model and thinking level", async () => {
    render();
    expect(trigger().textContent).toContain("Model One");
    expect(trigger().textContent).toContain("chat.thinkingLevel.medium");
  });

  // 页脚采用紧凑文字样式，显式覆盖 Button 的默认字重与图标尺寸。
  it("模型 chip 不继承 Button 的字重与图标尺寸", () => {
    render();

    const tokens = trigger().className.split(/\s+/);
    expect(tokens).toContain("font-normal");
    expect(tokens).toContain("[&_svg]:size-3");
    expect(tokens).not.toContain("font-medium");
    expect(tokens).not.toContain("[&_svg]:size-4");
    // 有意写的高度档与字号不许被这条守卫顺手收掉（否则就是越权）
    expect(tokens).toContain("h-7");
    expect(tokens).toContain("text-xs");
  });

  it("opens the panel on chip click", async () => {
    render();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await openPanel();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panel()).toBeDefined();
  });

  it("carries the shared panel shell tokens", async () => {
    render();
    await openPanel();
    expect(panel().className).toContain("shadow-elevated");
    expect(panel().className).toContain("border-border/40");
    expect(panel().className).not.toContain("shadow-soft");
  });

  it("caps the panel to the space available above the chip", async () => {
    render();
    // 面板底边 = 触发器顶边 - 8(sideOffset)，再让开 48(标题栏安全区)：300 - 8 - 48
    stubLayout({ triggerTop: 300 });
    await openPanel();
    expect(panel().style.maxHeight).toBe("244px");
  });

  it("keeps the 32rem ceiling when there is plenty of room", async () => {
    render();
    stubLayout({ triggerTop: 2000 });
    await openPanel();
    expect(panel().style.maxHeight).toBe("512px");
  });

  // Radix 在首帧把面板摆在 translate(0, -200%)（视口上方）等待定位，定位在
  // floating-ui 的 computePosition().then() 里才完成 —— 那之后没有新的重渲染，
  // 打开时的这次量测就是唯一一次。量面板就会量到这个负的 bottom 而放弃，
  // 只剩 className 上的 100vh - 12rem 兜底 —— WelcomeView 里那笔账是超的。
  // 所以量测必须锚在触发器上：它在打开之前就已布局完成，坐标与定位结果无关。
  it("caps by the trigger even before Radix has positioned the panel", async () => {
    render();
    // panelBottom 取实测的定位前坐标：面板高 512，wrapper translate(0, -200%)
    stubLayout({ triggerTop: 300, panelBottom: -512 });
    await openPanel();
    expect(panel().style.maxHeight).toBe("244px");
  });

  it("badges free models in the menu", async () => {
    render({
      modelOptions: [
        {
          profileKey: "profile-a" as never,
          groupLabel: "Provider A",
          items: [
            {
              id: "longcat-2.5-preview-free",
              name: "LongCat 2.5 Preview Free",
            },
            { id: "kimi-k3", name: "Kimi K3" },
          ],
        },
      ],
    });
    await openPanel();

    const items = panel().querySelectorAll('[role="option"]');
    expect(items[0]?.textContent).toContain("common.free");
    expect(items[1]?.textContent).not.toContain("common.free");
  });

  it("shows every group plus thinking row when logged out", async () => {
    render();
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).toContain("Provider A");
    expect(text).toContain("Provider B");
    expect(text).not.toContain("DeskWand");
    expect(text).toContain("modelMenu.thinkingWithValue");
  });

  it("shows the cloud group and user providers in the same panel", async () => {
    loginCloud();
    render({
      model: "deepseek-flash",
      activeProviderProfileKey: "custom:deskwand",
      thinkingLevel: "xhigh",
    });
    // 思考档不再由模式锁定，折叠态要显示用户当前档位（非默认档）
    expect(trigger().textContent).toContain("chat.thinkingLevel.xhigh");
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).toContain("DeskWand");
    expect(text).toContain("deepseek-flash");
    expect(text).toContain("deepseek-v4-pro");
    expect(text).toContain("Provider A");
    // 思考行就是列表层的最后一行：没有任何中间层入口排在它后面
    expect(text.endsWith("modelMenu.thinkingWithValue")).toBe(true);
  });

  it("shows the cloud group for BYOK providers too", async () => {
    loginCloud();
    render(); // activeProviderProfileKey = "profile-a"（BYOK）→ 云分组默认收起
    await openPanel();
    expect(panel().textContent).toContain("DeskWand");
    expect(panel().textContent).not.toContain("deepseek-flash");

    click(groupHeader("DeskWand"));
    expect(panel().textContent).toContain("deepseek-flash");
    expect(panel().textContent).toContain("deepseek-v4-pro");
    expect(panel().textContent).toContain("Provider A");
  });

  it("puts the cloud group first regardless of config order", async () => {
    loginCloud();
    const cloudLast: ModelOptionGroup[] = [
      ...modelOptions.filter((g) => g.profileKey !== "custom:deskwand"),
      modelOptions.find((g) => g.profileKey === "custom:deskwand")!,
    ];
    render({ modelOptions: cloudLast });
    await openPanel();
    const text = panel().textContent ?? "";
    // 分组标题按 DOM 顺序出现在 textContent 里，用下标比较断言顺序
    expect(text.indexOf("DeskWand")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("DeskWand")).toBeLessThan(text.indexOf("Provider A"));
  });

  it("selects a thinking level and returns to the list view", async () => {
    loginCloud();
    render({
      model: "deepseek-flash",
      activeProviderProfileKey: "custom:deskwand",
    });
    await openPanel();
    // 列表层直接可见思考行，不需要先钻进「自定义」视图
    const thinkingRow = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("modelMenu.thinkingWithValue"));
    click(thinkingRow);
    expect(panel().textContent).toContain("chat.thinkingLevel.high");
    const highButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("chat.thinkingLevel.high"));
    click(highButton);
    expect(baseProps.onSelectThinkingLevel).toHaveBeenCalledWith("high");
    // 自动回列表层，仍看得到分组
    expect(panel().textContent).toContain("Provider A");
  });

  it("closes on outside click", async () => {
    render();
    await openPanel();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await clickOutside();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the cloud group when not logged in", async () => {
    render(); // cloudConfig 默认 null
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).not.toContain("deepseek-flash");
    expect(text).toContain("Provider A");
  });

  it("uses the available-models copy when the list itself is empty", async () => {
    // 未登录时云分组被过滤掉；列表为空也要给出空态行，且思考行仍在（设计文档已记录的行为偏差）。
    // 这个场景下没有搜索框，文案不能再说「无匹配」——那是筛选语境的话术。
    render({
      modelOptions: modelOptions.filter(
        (g) => g.profileKey === "custom:deskwand",
      ),
    });
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).toContain("chat.noAvailableModel");
    expect(text).not.toContain("chat.noModelMatch");
    expect(text).toContain("modelMenu.thinkingWithValue");
  });

  it("shows no-match row when search filters everything out", async () => {
    render({ modelOptions: singleGroupOptions(9) });
    await openPanel();
    expect(panel().querySelector("input")).not.toBeNull();
    setSearchValue("zzz-nothing");
    expect(panel().textContent).toContain("chat.noModelMatch");
  });

  it("hides the search input while the list is short", async () => {
    render(); // 默认数据 3 分组 5 模型；未登录下云分组被剔除，可见 2 分组 3 模型
    await openPanel();
    expect(panel().querySelector("input")).toBeNull();
    expect(panel().textContent).toContain("Model One");
  });

  it("hides the search input at exactly the threshold", async () => {
    // 8 是阈值本身。`>` 写成 `>=` 的差异只有这一条能守住：
    // 上面那条可见 3 个模型、下面那条 9 个，两者都离边界很远。
    render({ modelOptions: singleGroupOptions(8) });
    await openPanel();
    expect(panel().querySelector("input")).toBeNull();
    expect(panel().textContent).toContain("Model 7");
  });

  // 思考行必须是滚动区之外的兄弟节点：它跟着列表一起滚过，就等于没有常驻。
  it("pins the thinking row below the scrolling model list", async () => {
    render({ modelOptions: singleGroupOptions(9) }); // 9 个模型 → 一定出现滚动区与搜索框
    await openPanel();

    const scroller = panel().querySelector('[data-testid="model-menu-list"]')!;
    expect(scroller).not.toBeNull();
    expect(scroller.contains(panel().querySelector("input"))).toBe(false);

    const thinkRow = Array.from(panel().querySelectorAll("button")).find((b) =>
      b.textContent?.includes("modelMenu.thinkingWithValue"),
    )!;
    expect(thinkRow).toBeDefined();
    // 思考行不在滚动容器内 —— 这是「常驻底部」的唯一结构性证据
    expect(scroller.contains(thinkRow)).toBe(false);
    expect(scroller.textContent).not.toContain("modelMenu.thinkingWithValue");

    // 面板自己不再是滚动容器：滚动条只属于中间那段列表
    expect(panel().className).toContain("flex-col");
    expect(panel().className).not.toContain("overflow-y-auto");
  });

  // 默认策略：只展开当前 provider，其余收成一行标题 —— 长列表不该一屏铺满。
  it("expands only the active provider group by default", async () => {
    render(); // activeProviderProfileKey = "profile-a"
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).toContain("Model One");
    // 其它分组的标题在（提供导航），但模型项不渲染
    expect(text).toContain("Provider B");
    expect(text).not.toContain("Model Three");
  });

  // 标题是用 Button 渲染的，与页脚 chip 同一个陷阱：base 的 font-medium 与
  // [&_svg]:size-4 不写回就会被顶回 14px/500 与 16px 图标。
  it("分组标题不继承 Button 的字重与图标尺寸", async () => {
    render();
    await openPanel();

    const tokens = groupHeader("Provider A").className.split(/\s+/);
    expect(tokens).toContain("font-normal");
    expect(tokens).toContain("[&_svg]:size-3");
    expect(tokens).not.toContain("font-medium");
    expect(tokens).not.toContain("[&_svg]:size-4");
    // size="xs" 的紧凑高度档，不能被缺省档的 h-9 顶掉
    expect(tokens).toContain("h-6");
  });

  it("toggles a provider group from its header", async () => {
    render();
    await openPanel();
    expect(groupHeader("Provider B").getAttribute("aria-expanded")).toBe(
      "false",
    );

    click(groupHeader("Provider B"));
    expect(groupHeader("Provider B").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(panel().textContent).toContain("Model Three");

    click(groupHeader("Provider B"));
    expect(panel().textContent).not.toContain("Model Three");
  });

  // 当前 provider 不可见时（未登录 → 云分组被剔除，active 还指着云 provider），
  // 必须退到第一个可见分组；否则面板打开只剩标题，用户会以为模型列表挂了。
  it("falls back to the first visible group when the active one is hidden", async () => {
    render({
      model: "deepseek-flash",
      activeProviderProfileKey: "custom:deskwand",
    }); // 未登录
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).toContain("Model One");
    expect(text).not.toContain("deepseek-flash");
  });

  // 折叠引入的新失败模式：命中项落在被折叠的分组里，不能被吞掉。
  it("expands collapsed groups while searching", async () => {
    render({
      modelOptions: [
        {
          profileKey: "profile-a" as never,
          groupLabel: "Provider A",
          items: Array.from({ length: 9 }, (_, i) => ({
            id: `a-${i}`,
            name: `A Model ${i}`,
          })),
        },
        {
          profileKey: "profile-b" as never,
          groupLabel: "Provider B",
          items: [{ id: "needle", name: "Needle Model" }],
        },
      ],
    }); // 10 个可见模型 → 有搜索框
    await openPanel();
    expect(panel().textContent).not.toContain("Needle Model");
    expect(groupHeader("Provider B").getAttribute("aria-expanded")).toBe(
      "false",
    );

    setSearchValue("needle");
    expect(panel().textContent).toContain("Needle Model");
    expect(panel().textContent).not.toContain("chat.noModelMatch");
    // 搜索态下标题退回静态标签：不留一个点了没反应的 chevron（见计划 Step 5）
    expect(
      Array.from(panel().querySelectorAll("button")).filter(
        (b) => b.getAttribute("aria-expanded") !== null,
      ),
    ).toHaveLength(0);
  });

  // 折叠状态是「这一眼」的临时取舍，不跨次记忆。
  it("resets group expansion when the panel reopens", async () => {
    render();
    await openPanel();
    click(groupHeader("Provider B"));
    expect(panel().textContent).toContain("Model Three");

    await clickOutside();
    await openPanel();
    expect(panel().textContent).not.toContain("Model Three");
    expect(panel().textContent).toContain("Model One");
  });

  // 选中模型后 activeProviderProfileKey 会变；刚点开的那组不能因为 props 变化自己收起。
  it("keeps the clicked group open after picking a model from it", async () => {
    render({ model: "model-3", activeProviderProfileKey: "profile-b" });
    await openPanel();
    click(groupHeader("Provider A"));
    expect(panel().textContent).toContain("Model One");

    // 模拟选完模型后调用方回传新 props（同一组件实例，不重新挂载）
    render({ model: "model-1", activeProviderProfileKey: "profile-a" });
    expect(panel().textContent).toContain("Model One");
    expect(panel().textContent).toContain("Model Three");
  });

  it("shows the search input once the visible models exceed the threshold", async () => {
    render({ modelOptions: singleGroupOptions(9) });
    await openPanel();
    expect(panel().querySelector("input")).not.toBeNull();
  });

  it("drops the filter when the list shrinks below the threshold", async () => {
    render({ modelOptions: singleGroupOptions(9) });
    await openPanel();
    setSearchValue("zzz-nothing");
    expect(panel().textContent).toContain("chat.noModelMatch");

    // 这里用替换 props 模拟同一场收缩（生产上的触发是后台 401 → isLoggedIn 变
    // false → 云分组消失）。两条路径触发的是 visibleModelOptions 的同一次重算，
    // 因为它的 memo 依赖就是 [modelOptions, isLoggedIn]；isLoggedIn 那条路径本身
    // 已由上面「hides the cloud group when not logged in」等用例守住。
    // 收缩之后搜索框卸载，残留的 query 必须一起失效，否则列表会停在一个
    // 用户既无法解释、也无法清空的过滤结果上。
    render({ modelOptions: singleGroupOptions(2) });
    expect(panel().querySelector("input")).toBeNull();
    expect(panel().textContent).toContain("Model 0");
    expect(panel().textContent).not.toContain("chat.noModelMatch");
  });

  it("hides the group label when there is only one group", async () => {
    render({ modelOptions: singleGroupOptions(3) }); // 3 个模型、1 个分组
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).not.toContain("Provider A");
    expect(text).toContain("Model 0");
  });

  it("keeps group labels when there are several groups", async () => {
    render(); // 默认数据：未登录下可见 2 个分组
    await openPanel();
    const text = panel().textContent ?? "";
    expect(text).toContain("Provider A");
    expect(text).toContain("Provider B");
  });

  it("counts visible models, not raw props, for both thresholds", async () => {
    // 未登录时云分组被 visibleModelOptions 剔除，但它在 props 里仍然在。
    // 这条数据 raw 是 2 分组 9 模型，visible 是 1 分组 7 模型——两个判据都必须按
    // visible 算：按 raw 算会长出搜索框（9 > 8）和分组标题（2 > 1），两个断言都会红。
    render({
      modelOptions: [
        {
          profileKey: "custom:deskwand" as never,
          groupLabel: "DeskWand",
          items: [
            { id: "cloud-1", name: "Cloud One" },
            { id: "cloud-2", name: "Cloud Two" },
          ],
        },
        ...singleGroupOptions(7),
      ],
    }); // cloudConfig 默认 null = 未登录
    await openPanel();
    const text = panel().textContent ?? "";
    expect(panel().querySelector("input")).toBeNull();
    expect(text).not.toContain("DeskWand");
    expect(text).not.toContain("Provider A");
    expect(text).toContain("Model 6");
  });
});
