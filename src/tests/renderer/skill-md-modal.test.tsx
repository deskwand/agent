// @vitest-environment jsdom
//
// SkillMdModal 迁到 OccludingDialog 后的行为不变量。
//
// 迁移前它是一整块自建遮罩：fixed inset-0 + 自己的 overlayRef、自己挂
// document 的 keydown 监听处理 Escape、自己画右上角 X、没有 occlusion（浏览器
// 面板打开时会被原生视图盖住）。迁移后外壳交给既有的 `OccludingDialog` +
// vendored `ui/dialog`，本文件锁的是「外壳换了，既有行为一条没丢」：
//   - role="dialog" 与 occlusion 都到位（旧实现两条都没有）
//   - 关闭矩阵（constraints.md 任务 1 行）：外点允许、Escape 允许、X 允许，
//     loading 不阻塞关闭 —— 每条都只是**一次** onClose
//   - 内容点击不关闭（旧实现是遮罩 onClick + target 判定，语义等价）
//   - content / loading / 空态三分支都在，且 loading → content 的重渲染会更新内容
//   - 键盘焦点进入弹窗；关闭后回到 opener；opener 已移除时走 onRestoreFocus fallback
//
// 为什么查询作用域是 `document.body` 而不是本文件的 container：
// Radix 的 DialogContent 经 **Portal 挂到 document.body**（confirm-dialog.test.tsx 同款），
// 查 container 会假绿。
//
// 初始化/卸载抄 confirm-dialog.test.tsx：本仓没有 vitest setupFiles，
// i18n/config 是 import 即初始化，必须显式 import；不 mock Dialog 原语 ——
// 这一组用例要验的正是原语本身的行为。
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import fs from "node:fs";
import path from "node:path";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { SkillMdModal } from "../../renderer/components/SkillMdModal";
import { RENDERER } from "./theme-css-helpers";

// Markdown 渲染器换成纯文本：本文件测的是弹窗外壳，不是 markdown 管线。
// 断言 content 用 data-testid 准确定位，避免整篇 body 文本包含关系带来的假绿。
vi.mock("../../renderer/components/MessageMarkdown", () => ({
  MessageMarkdown: ({ normalizedText }: { normalizedText: string }) => (
    <div data-testid="markdown">{normalizedText}</div>
  ),
}));

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/** Radix 的 Presence 在 setTimeout(…, 0) 里挂载/移焦，断言前先推一个宏任务。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // Portal 挂在 document.body 上，不随 container 移除
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

function closeButton(): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(
    `[role="dialog"] button[aria-label="${i18n.t("common.close")}"]`,
  );
}

/** loading 分支的转圈图标（Loader2）。 */
function loader(): Element | null {
  return document.body.querySelector(
    "svg.lucide-loader-circle, svg.lucide-loader-2",
  );
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        // 不声明 cancelable 的话 Radix 的 preventDefault 是空操作
        cancelable: true,
      }),
    );
  });
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function pointerDown(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
  });
}

/** 受控弹窗：父级翻 isOpen（与调用方 SettingsSkills 的契约一致）。 */
function Harness({
  onClose,
  content = "body",
  loading,
}: {
  onClose: () => void;
  content?: string | null;
  loading?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <SkillMdModal
      isOpen={open}
      title="Probe"
      content={content}
      loading={loading}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    />
  );
}

/**
 * 带真实 opener 的 harness（回焦用例用）。
 *
 * ⚠️ opener 必须挂在**有状态的 React 树**里，不能手动 `container.appendChild`：
 * `root.render()` 会清掉 container 的中已存在的子节点，手动挂的 opener 在首次渲染时
 * 就被 React 移除、焦点跌回 body，`onOpenAutoFocus` 于是捕获不到任何目标（探针实测 ✓）。
 * 真实入口（SkillCard 按钮）本来就在 React 树里，这才是忠实的 fixture。
 */
function OpenerHarness({
  onClose,
  onRestoreFocus,
  showOpener = true,
}: {
  onClose: () => void;
  /** 仅记数用；真正的回焦落在下面那个真实的可聚焦 fallback 节点上。 */
  onRestoreFocus?: () => void;
  showOpener?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {showOpener && (
        <button ref={openerRef} type="button" onClick={() => setOpen(true)}>
          open
        </button>
      )}
      {/* 父级根容器的忠实替身：真实可聚焦（tabIndex=-1，不进 Tab 顺序）且真会被 focus。
          裸 vi.fn() 不满足约束里的 focusable fallback 契约（review round1 IMPORTANT3）。 */}
      <div ref={fallbackRef} data-testid="fallback" tabIndex={-1} />
      <SkillMdModal
        isOpen={open}
        title="Probe"
        content="body"
        onRestoreFocus={() => {
          onRestoreFocus?.();
          fallbackRef.current?.focus({ preventScroll: true });
        }}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * 连接、未 disabled、但**已不可聚焦**的返回目标（契约里“落焦不成功则走 fallback”那条分支）。
 *
 * `<a href>` 可聚焦，摘掉 href 后 jsdom 的 `focus()` 变成 no-op
 *（`isFocusableAreaElement` 对无 href 的 a 返回 false），而元素仍 isConnected、也非
 * `:disabled` —— 正是这条分支的形态，且不是 mock 原语。
 */
function UnfocusableTargetHarness({
  onClose,
  linked = true,
  onRestoreFocus,
}: {
  onClose: () => void;
  linked?: boolean;
  onRestoreFocus?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const fallbackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <a
        href={linked ? "#" : undefined}
        data-testid="link-opener"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        open
      </a>
      <div ref={fallbackRef} data-testid="fallback" tabIndex={-1} />
      <SkillMdModal
        isOpen={open}
        title="Probe"
        content="body"
        onRestoreFocus={() => {
          onRestoreFocus?.();
          fallbackRef.current?.focus({ preventScroll: true });
        }}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </>
  );
}

function openerButton(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>("button");
  expect(el, "opener 必须存在").not.toBeNull();
  return el as HTMLButtonElement;
}

/** 聚焦 opener → 点开弹窗（jsdom 的 click 不会自动聚焦，必须显式 focus）。 */
async function openFromOpener(): Promise<void> {
  const opener = openerButton();
  opener.focus();
  expect(document.activeElement).toBe(opener);
  await click(opener);
  await flush();
}

describe("SkillMdModal", () => {
  it("渲染进 role=dialog，标题可见，并占用 occlusion", async () => {
    const onClose = vi.fn();
    await render(
      <SkillMdModal isOpen title="Probe" content="body" onClose={onClose} />,
    );
    const el = dialog();
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("Probe");
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape 关闭一次并释放 occlusion", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    await flush();
    expect(dialog()).not.toBeNull();

    await pressEscape();
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("本地化关闭键关闭一次并释放 occlusion", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    await flush();

    const btn = closeButton();
    expect(
      btn,
      "本地化 aria-label=common.close 的关闭键必须存在",
    ).not.toBeNull();
    expect(
      btn?.querySelector("svg"),
      "关闭键里是 X 图标（不是 vendored 的英文内置键）",
    ).not.toBeNull();
    await click(btn as HTMLButtonElement);
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("vendored 内置角标被调用点屏蔽（否则弹窗里有两个关闭键）", async () => {
    // 参考 image-lightbox-shell.test.tsx 的同名不变量：vendored DialogContent 末尾
    // 总会画一个 `absolute right-4 top-4` 的角标，可访问名是上游硬编码的英文 "Close"。
    // jsdom 不跑 CSS，所以断言的是那条类名本身。
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    await flush();

    const content = dialog();
    expect(content, "内容必须存在").not.toBeNull();
    expect(
      content!.className,
      "必须屏蔽 DialogContent 的内置角标，否则预览里有两个关闭键",
    ).toContain("[&>button]:hidden");
    // 角标仍在 DOM 里（由 CSS 隐藏），且它是 DialogContent 唯一的直接子 button ——
    // 即这个选择器不会误伤头部容器里那个本地化关闭键。
    expect(
      document.body.querySelectorAll('[role="dialog"] > button'),
      "直接子 button 恰好是内置角标那一个",
    ).toHaveLength(1);
  });

  it("点击遮罩关闭一次（矩阵：外部点击允许）", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    await flush();

    // 遮罩是 DialogContent 的**上一个兄弟**（DialogPortal 里 Overlay 在 Content 之前）。
    // 只向这一个真实元素派发事件，不另派 body 事件 —— 否则遮罩接线断了也可能被
    // 后面的 body 事件掩盖。
    const overlay = dialog()?.previousElementSibling ?? null;
    expect(overlay, "遮罩层必须存在").not.toBeNull();

    // 真实时序（读 vendored @radix-ui/react-dismissable-layer + dialog 实测）：
    // modal DialogContent 传 `deferPointerDownOutside: true`，所以 pointerdown 只登记
    // 「点击落在外面」并挂一个一次性 document click 监听，**此时还不 dismiss**；
    // 真正的 dismiss 在紧随其后的 click 上。因此两步都必须发，且都发在遮罩上。
    await pointerDown(overlay as Element);
    expect(
      onClose,
      "延迟判定：pointerdown 本身还不该关（这条不出意味着时序变了）",
    ).not.toHaveBeenCalled();
    expect(dialog(), "pointerdown 后弹窗仍在").not.toBeNull();

    await click(overlay as Element);
    await flush();

    expect(
      onClose,
      "遮罩上的 pointerdown+click 必须关一次",
    ).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("弹窗内容点击不关闭", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    await flush();

    const markdown = document.body.querySelector('[data-testid="markdown"]');
    expect(markdown).not.toBeNull();
    await pointerDown(markdown as Element);
    await click(markdown as Element);
    await flush();

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("loading 不阻塞关闭（Esc 仍回调一次）", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} loading content={null} />);
    await flush();
    // 断言 loading 分支本身（转圈图标），不用总在那里的标题
    expect(loader(), "必须先处于 loading 分支").not.toBeNull();

    await pressEscape();
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("loading 时点击本地化关闭键仍回调一次", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} loading content={null} />);
    await flush();
    expect(loader(), "必须先处于 loading 分支").not.toBeNull();

    await click(closeButton() as HTMLButtonElement);
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("loading → content 重渲染后展示新内容", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} loading content={null} />);
    expect(document.body.querySelector('[data-testid="markdown"]')).toBeNull();
    expect(loader(), "loading 分支要有转圈图标").not.toBeNull();

    await render(<Harness onClose={onClose} content="loaded body" />);
    await flush();

    const markdown = document.body.querySelector('[data-testid="markdown"]');
    expect(markdown?.textContent).toBe("loaded body");
    expect(loader()).toBeNull();
  });

  it("无内容且非 loading 时是空态文案", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} content={null} />);
    const el = dialog();
    expect(el, "空态查询必须限定在弹窗内").not.toBeNull();
    expect(
      el?.querySelector(`p`)?.textContent,
      "弹窗内那个 p 就是空态文案",
    ).toContain(i18n.t("skillMarket.noContent"));
  });

  it("关闭时 occlusion 归零，卸载时也归零", async () => {
    const onClose = vi.fn();
    await render(
      <SkillMdModal
        isOpen={false}
        title="Probe"
        content="body"
        onClose={onClose}
      />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);

    await render(
      <SkillMdModal isOpen title="Probe" content="body" onClose={onClose} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await render(
      <SkillMdModal
        isOpen={false}
        title="Probe"
        content="body"
        onClose={onClose}
      />,
    );
    await flush();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);

    await render(
      <SkillMdModal isOpen title="Probe" content="body" onClose={onClose} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    act(() => root.unmount());
    root = createRoot(container);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("打开后键盘焦点进入弹窗", async () => {
    const onClose = vi.fn();
    await render(<OpenerHarness onClose={onClose} />);
    await openFromOpener();

    const el = dialog();
    expect(el).not.toBeNull();
    expect(
      el?.contains(document.activeElement),
      "焦点必须落在弹窗内（Radix FocusScope 的默认行为）",
    ).toBe(true);
  });

  it("关闭后焦点回到 opener", async () => {
    const onClose = vi.fn();
    await render(<OpenerHarness onClose={onClose} />);
    await openFromOpener();

    await pressEscape();
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement, "关闭后必须回到 opener").toBe(
      openerButton(),
    );
  });

  it("opener 已被移除时走 onRestoreFocus fallback（真实可聚焦节点）", async () => {
    const onClose = vi.fn();
    const onRestoreFocus = vi.fn();
    await render(
      <OpenerHarness onClose={onClose} onRestoreFocus={onRestoreFocus} />,
    );
    await openFromOpener();

    // 目标在弹窗打开期间消失（列表刷新 / 删除），返回目标不再可聚焦。
    // 同一组件类型重渲染会保留 open 状态，只是把 opener 摘掉。
    await render(
      <OpenerHarness
        onClose={onClose}
        onRestoreFocus={onRestoreFocus}
        showOpener={false}
      />,
    );
    await pressEscape();
    await flush();

    expect(
      onRestoreFocus,
      "回不到原目标时用父级 fallback",
    ).toHaveBeenCalledTimes(1);
    // 不只断 spy：fallback 必须真的把焦点落在那个节点上
    const fallback = container.querySelector('[data-testid="fallback"]');
    expect(fallback).not.toBeNull();
    expect(document.activeElement, "fallback 节点必须拿到焦点").toBe(fallback);
  });

  it("目标连接但已不可聚焦时走 fallback（新契约的落焦检查）", async () => {
    // 契约：连接且非 disabled 也要试 focus({preventScroll:true})，
    // 若 activeElement 仍不是它，才用 fallback。
    const onClose = vi.fn();
    const onRestoreFocus = vi.fn();
    await render(
      <UnfocusableTargetHarness
        onClose={onClose}
        onRestoreFocus={onRestoreFocus}
      />,
    );
    const link = container.querySelector<HTMLAnchorElement>(
      '[data-testid="link-opener"]',
    );
    expect(link, "link opener 必须存在").not.toBeNull();
    (link as HTMLAnchorElement).focus();
    expect(document.activeElement, "打开前焦点在 link 上").toBe(link);
    await click(link as HTMLAnchorElement);
    await flush();
    expect(dialog()).not.toBeNull();

    // 弹窗开着时摘掉 href：元素仍 isConnected、也不是 :disabled，但 jsdom 里已不可聚焦
    await render(
      <UnfocusableTargetHarness
        onClose={onClose}
        linked={false}
        onRestoreFocus={onRestoreFocus}
      />,
    );
    expect((link as HTMLAnchorElement).isConnected).toBe(true);
    expect((link as HTMLAnchorElement).matches(":disabled")).toBe(false);

    await pressEscape();
    await flush();

    expect(onRestoreFocus, "落焦不成功时用 fallback").toHaveBeenCalledTimes(1);
    const fallback = container.querySelector('[data-testid="fallback"]');
    expect(document.activeElement, "fallback 节点必须拿到焦点").toBe(fallback);
  });

  it("Tab 焦点锁在弹窗内", async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    await flush();

    const el = dialog();
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();

    expect(el?.contains(document.activeElement), "Tab 后焦点仍在弹窗内").toBe(
      true,
    );
  });
});

/**
 * SettingsSkills 侧的接线（源码扫描，不拉 IPC 桩）。
 *
 * 为什么不用渲染式测试：SettingsSkills 一挂载就会走多条 IPC / 网络路径，
 * 要让它可渲染得搭一大套 mock —— review round1 明确要求不用大量 IPC mock 扩张
 * 测试架构。这里锁三件不可省的事：根容器带 ref+tabIndex=-1、根可聚焦但保留原生
 * 焦点可见性（不加 outline-none）、fallback 走 preventScroll。
 */
describe("SettingsSkills 的回焦接线", () => {
  const src = (): string =>
    fs.readFileSync(
      path.join(RENDERER, "components/settings/SettingsSkills.tsx"),
      "utf8",
    );

  it("根容器是可聚焦的 fallback（ref + tabIndex=-1），不隐藏原生焦点", () => {
    const source = src();
    // 先确认扫到东西，否则下面几条会空转假绿
    expect(source.length).toBeGreaterThan(1000);
    expect(source, "根容器必须是 ref=rootRef + tabIndex=-1").toContain(
      'ref={rootRef} tabIndex={-1} className="space-y-4"',
    );
    expect(source, "rootRef 必须是 HTMLDivElement ref").toContain(
      "const rootRef = useRef<HTMLDivElement>(null)",
    );
    // 保留原生焦点可见性：只查**根元素开标签那一段**。全文 not.toContain("outline-none")
    // 会误触既有的搜索框 `focus:outline-none`（与本任务无关的旧代码）。
    const rootTagStart = source.indexOf("ref={rootRef} tabIndex={-1}");
    const rootTag = source.slice(
      rootTagStart,
      source.indexOf(">", rootTagStart),
    );
    expect(rootTag, "根容器不得隐藏原生焦点可见性").not.toContain("outline");
  });

  it("传入的 onRestoreFocus 聚焦根容器且带 preventScroll", () => {
    expect(src()).toContain(
      "onRestoreFocus={() => rootRef.current?.focus({ preventScroll: true })}",
    );
  });
});
