// @vitest-environment jsdom
//
// TopUpModal 迁到 OccludingDialog 后的行为不变量（计划 13 · Task 2 充值子段）。
//
// 迁移前它是一整块自建外壳：`fixed inset-0 bg-black/50` 的外层 + `onClick` 关闭、
// 内层面板 `onClick={stopPropagation}`、没有 occlusion（浏览器面板打开时会被原生视图盖住）、
// 没有 role="dialog"、没有回焦。迁移后外壳交给既有的 `OccludingDialog` + vendored
// `DialogContent/DialogTitle`，本文件锁的是「外壳换了，业务一条没丢」：
//   - role="dialog" + DialogTitle 文案 + occlusion；无 token / 关闭时不渲染、不占 occlusion
//   - 关闭矩阵：遮罩（外点）允许；Escape 禁止（preventDefault，不是只禁按钮）；waiting
//     结果区原有的关闭按钮保留；**不新增 header X**（vendored 角标用 `[&>button]:hidden` 屏蔽）
//   - 金额 / 订单创建协议 / 支付状态 / 打开重置 / 轮询：逐条锁住，都不因换外壳而变
//   - 回焦：关闭后回到打开前的元素；目标没了 / 事件类入口（body 无焦点）走 onRestoreFocus
//
// 只 mock **服务**（CloudApiClient / QRCode），不 mock Radix 原语 —— 这一组用例要验的
// 正是原语本身的行为。fixture 的返回形状取自 `services/cloud-api.ts` 的真实方法签名
// （`Awaited<ReturnType<CloudApiClient[...]>>`），避免手抄形状漂移。
//
// 查询作用域是 `document.body`：DialogContent 经 Portal 挂到 body（confirm-dialog.test.tsx 同款），
// 查本文件的 container 会假绿。`cloudConfig` 用**真实 store** 播种（fake token 即可，
// `CloudApiClient` 已被 mock，不会发请求）。
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import fs from "node:fs";
import path from "node:path";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { CloudApiClient } from "../../renderer/services/cloud-api";
import { TopUpModal } from "../../renderer/components/TopUpModal";
import { AccountMenu } from "../../renderer/components/AccountMenu";
import { RENDERER } from "./theme-css-helpers";

/** 与 `CloudApiClient` 同形状的服务桩（被 mock 的只有服务，不是原语）。 */
const api = vi.hoisted(() => ({
  createTopUpOrder: vi.fn(),
  getTopUpOrder: vi.fn(),
  getMe: vi.fn(),
  getTopUpOrders: vi.fn(),
}));

vi.mock("../../renderer/services/cloud-api", () => ({
  CloudApiClient: class {
    createTopUpOrder = api.createTopUpOrder;
    getTopUpOrder = api.getTopUpOrder;
    getMe = api.getMe;
    getTopUpOrders = api.getTopUpOrders;
  },
}));

const qr = vi.hoisted(() => ({ toDataURL: vi.fn() }));

vi.mock("qrcode", () => ({
  default: { toDataURL: qr.toDataURL },
}));

type CreatedOrder = Awaited<ReturnType<CloudApiClient["createTopUpOrder"]>>;
type OrderStatus = Awaited<ReturnType<CloudApiClient["getTopUpOrder"]>>;
type Me = Awaited<ReturnType<CloudApiClient["getMe"]>>;

const TOKEN = "fake-token";

function createdOrder(overrides: Partial<CreatedOrder> = {}): CreatedOrder {
  return {
    id: "order-1",
    chain: "bsc",
    amount_cents: 10000,
    deposit_address: "0xDEPOSITADDRESS",
    expires_at: "2026-10-11 12:30:00",
    ...overrides,
  };
}

function orderStatus(overrides: Partial<OrderStatus> = {}): OrderStatus {
  return {
    id: "order-1",
    status: "pending",
    credited_micro_usd: 0,
    tx_hash: "",
    confirmed_at: null,
    expires_at: "2026-10-11 12:30:00",
    ...overrides,
  };
}

function me(balanceMicroUsd = 0): Me {
  return {
    email: "me@example.com",
    level: "free",
    balance_micro_usd: balanceMicroUsd,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  api.createTopUpOrder.mockReset().mockResolvedValue(createdOrder());
  api.getTopUpOrder.mockReset().mockResolvedValue(orderStatus());
  api.getMe.mockReset().mockResolvedValue(me(0));
  api.getTopUpOrders
    .mockReset()
    .mockResolvedValue({ orders: [], has_more: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // Portal 挂在 document.body 上，不随 container 移除
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 真实 store 播种 cloudConfig（fake token）。 */
function seedCloud(token: string | null): void {
  act(() => {
    useAppStore.getState().setCloudConfig(
      token === null
        ? null
        : {
            serverUrl: "https://cloud.example",
            token,
            isLoggedIn: true,
            email: "me@example.com",
            level: "free",
            balanceMicroUsd: 0,
          },
    );
  });
}

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/** Radix 的 Presence 在下一帧里挂载/移焦 ⇒ 断言前先推一批宏任务。 */
async function flush(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(20);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]');
}

function dialogButtons(): HTMLButtonElement[] {
  const el = dialog();
  return el ? Array.from(el.querySelectorAll("button")) : [];
}

function buttonByText(label: string): HTMLButtonElement {
  const el = dialogButtons().find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  if (!el) throw new Error(`弹窗里找不到按钮「${label}」`);
  return el;
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

/** 遮罩层：DialogPortal 里 Overlay 是 Content 的前一个兄弟。 */
function overlay(): Element | null {
  return dialog()?.previousElementSibling ?? null;
}

/**
 * Radix FocusScope 的 tabbable 候选：`tabIndex >= 0` 且 computedStyle 不是
 * `display:none` / `visibility:hidden`（与 vendored `getTabbableEdges` 同口径）。
 *
 * ⚠️ jsdom **不加载 CSS** ⇒ 被 `[&>button]:hidden` 屏蔽的 vendored 角标在这里**仍算 tabbable**，
 * 所以下面算出的「最后一个」在真实 Electron 里其实是隐藏的、不进 Tab 序列（真实序列会早一步回绕
 * 到第一个）。本用例只证明 FocusScope 的回绕**边界**，不冒称 Electron 实际 Tab 行为已验收。
 */
function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "button, input, textarea, select, a[href], [tabindex]",
    ),
  ).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.tabIndex >= 0;
  });
}

/** 点遮罩关闭：Radix 的 modal Content 传 `deferPointerDownOutside: true` ⇒ 两发都要。 */
async function clickOverlay(): Promise<void> {
  const panel = overlay();
  expect(panel, "遮罩层必须存在").not.toBeNull();
  await pointerDown(panel as Element);
  await click(panel as Element);
  await flush();
}

async function openTopUp(): Promise<void> {
  await act(async () => {
    useAppStore.getState().setTopUpOpen(true);
  });
  await flush();
}

async function closeTopUp(): Promise<void> {
  await act(async () => {
    useAppStore.getState().setTopUpOpen(false);
  });
  await flush();
}

/** 在金额框里打字：必须走 native setter，否则 React 的 `_valueTracker` 会抑制 onChange。 */
async function typeAmount(value: string): Promise<void> {
  // ⚠️ 不能写 `expect(input).not.toBeNull()`：`?.` 在弹窗缺失时给的是 `undefined`，
  // `expect(undefined).not.toBeNull()` 会假绿（本轮实测踩到过）。显式抛错才真红。
  const input =
    dialog()?.querySelector<HTMLInputElement>('input[inputmode="decimal"]') ??
    null;
  if (!input) throw new Error("金额输入框必须存在（弹窗 / 金额步缺失）");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickNext(): Promise<void> {
  await click(buttonByText(i18n.t("topUp.next")));
  await flush();
}

/** amount → chain → pay（订单已创建）。 */
async function gotoPay(): Promise<void> {
  await typeAmount("100");
  await clickNext();
  await clickNext();
  await flush();
}

/** amount → chain → pay → waiting（轮询已启动）。 */
async function gotoWaiting(): Promise<void> {
  await gotoPay();
  await clickNext();
  await flush();
}

/** 带真实 opener 的 harness（回焦用例用；App 里的入口是 AccountMenu / MessageCard）。 */
function Harness({
  onRestoreFocus,
  showOpener = true,
}: {
  onRestoreFocus?: () => void;
  showOpener?: boolean;
}): JSX.Element {
  const fallbackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {showOpener && (
        <button
          type="button"
          data-testid="opener"
          onClick={() => useAppStore.getState().setTopUpOpen(true)}
        >
          topup
        </button>
      )}
      {/* App `<main>` fallback 的忠实替身：真实可聚焦（tabIndex=-1）、真会被 focus */}
      <div ref={fallbackRef} data-testid="fallback" tabIndex={-1} />
      <TopUpModal
        onRestoreFocus={
          onRestoreFocus
            ? () => {
                onRestoreFocus();
                fallbackRef.current?.focus({ preventScroll: true });
              }
            : undefined
        }
      />
    </>
  );
}

describe("TopUpModal 外壳（自建遮罩 → OccludingDialog）", () => {
  it("open=true 渲染 role=dialog、标题，并占 1 个 occlusion", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    expect(dialog(), "未打开时不该有弹窗").toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);

    await openTopUp();
    const el = dialog();
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain(i18n.t("topUp.title"));
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await closeTopUp();
    expect(dialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("没有 cloud token 时不渲染 Dialog、不占 occlusion（open 也一样）", async () => {
    seedCloud(null);
    await render(<TopUpModal />);
    await openTopUp();
    expect(useAppStore.getState().topUpOpen, "store 里确实被要求打开").toBe(
      true,
    );
    expect(dialog(), "没有 token 不能出现空 Dialog").toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("遮罩点击关闭一次（矩阵：外部点击允许）", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();
    const panel = overlay();
    expect(panel, "遮罩层必须存在").not.toBeNull();
    // modal Content 传 `deferPointerDownOutside: true`：pointerdown 只登记，click 才 dismiss
    await pointerDown(panel as Element);
    expect(useAppStore.getState().topUpOpen, "pointerdown 还不该关").toBe(true);
    await click(panel as Element);
    await flush();
    expect(useAppStore.getState().topUpOpen).toBe(false);
    expect(dialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("Escape 关闭（Task2 review 修订后的矩阵：允许）并回焦 opener", async () => {
    // 修订理由：modal 的 FocusScope + 无 header X + 禁止 Escape 会构成键盘陷阱；
    // controller 裁定 TopUp 的 Escape 格改为「允许」，走既有 onOpenChange(false) 同一条关闭路径。
    seedCloud(TOKEN);
    await render(<Harness />);
    const opener = container.querySelector<HTMLButtonElement>(
      '[data-testid="opener"]',
    )!;
    opener.focus();
    await click(opener);
    await flush();
    expect(dialog()).not.toBeNull();

    await pressEscape();
    await flush();

    expect(useAppStore.getState().topUpOpen).toBe(false);
    expect(dialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
    expect(document.activeElement, "Escape 关闭后同样要回焦").toBe(opener);
  });

  it("不新增 header X：vendored 角标被屏蔽（无本地化关闭键）", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();

    const el = dialog();
    expect(el).not.toBeNull();
    // vendored 角标必须被屏蔽（否则等于凭空多一个关闭入口）
    expect(el!.className).toContain("[&>button]:hidden");
    expect(
      document.body.querySelectorAll('[role="dialog"] > button'),
      "直接子 button 恰好是 vendored 角标那一个",
    ).toHaveLength(1);
    // 调用点自己也没有画本地化关闭键
    expect(
      el!.querySelector(`button[aria-label="${i18n.t("common.close")}"]`),
      "不得新增 header X",
    ).toBeNull();
  });

  it("waiting 结果区原有的关闭按钮仍能关闭（矩阵：允许）", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.waitingTitle"));

    await click(buttonByText(i18n.t("topUp.close")));
    await flush();
    expect(useAppStore.getState().topUpOpen).toBe(false);
    expect(dialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("打开时重置到金额步；关闭再打开也是金额步", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.chainLabel"));

    await closeTopUp();
    await openTopUp();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.amountLabel"));
    expect(
      dialog()?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
        ?.value,
      "重开必须是空金额",
    ).toBe("");
    expect(dialog()?.textContent).not.toContain(i18n.t("topUp.chainLabel"));
  });

  it("弹窗打开期间的重渲染不丢业务状态（订单仍在 pay 步）", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();
    await gotoPay();
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");

    // 外壳层重渲染（store 同值 set 会换 state 对象）不该重置业务 state
    await act(async () => {
      useAppStore.getState().setTopUpOpen(true);
    });
    await flush();
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");
    // ⚠️ 不能用 `not.toContain(amountLabel)`：英文的 amountLabel 是 "Amount"，
    // 而 pay 步的 amountToSend 文案是 "Amount to send" ⇒ 子串假红。
    expect(
      dialog()?.querySelector('input[inputmode="decimal"]'),
      "仍在 pay 步（金额输入框不该回来）",
    ).toBeNull();
  });
});

describe("TopUpModal 业务协议不因换外壳而变", () => {
  it("金额与网络原样传给 createTopUpOrder", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    await click(buttonByText(i18n.t("topUp.chainBase")));
    await clickNext();
    await flush();

    expect(api.createTopUpOrder).toHaveBeenCalledTimes(1);
    expect(api.createTopUpOrder).toHaveBeenCalledWith(10000, "base");
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");
  });

  it("confirmed：展示到账金额并刷新余额快照", async () => {
    seedCloud(TOKEN);
    api.getTopUpOrder.mockResolvedValue(
      orderStatus({ status: "confirmed", credited_micro_usd: 10_000_000 }),
    );
    api.getMe.mockResolvedValue(me(25_000_000));
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();
    await flush();
    await flush();

    expect(dialog()?.textContent).toContain(
      i18n.t("topUp.confirmed", { usd: "$10.00" }),
    );
    expect(api.getTopUpOrder).toHaveBeenCalledWith("order-1");
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().cloudConfig?.balanceMicroUsd).toBe(
      25_000_000,
    );
  });

  it("orderExpired：展示过期文案", async () => {
    seedCloud(TOKEN);
    api.getTopUpOrder.mockResolvedValue(orderStatus({ status: "expired" }));
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();
    await flush();
    await flush();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.orderExpired"));
  });

  it("timeout：10 分钟后仍是等待确认（假定时器推进）", async () => {
    seedCloud(TOKEN);
    vi.useFakeTimers();
    api.getTopUpOrder.mockResolvedValue(orderStatus());
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 10_000);
    });
    expect(dialog()?.textContent).toContain(i18n.t("topUp.timeout"));
  });

  it("下单网络错误：chain 步展示原文案（不是只在 waiting 才显示）", async () => {
    seedCloud(TOKEN);
    api.createTopUpOrder.mockRejectedValue(new Error("boom"));
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    await clickNext();
    await flush();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.networkError"));
    expect(dialog()?.textContent).toContain(i18n.t("topUp.chainLabel"));
  });

  it("TOO_MANY_PENDING：chain 步展示未完成订单文案", async () => {
    seedCloud(TOKEN);
    api.createTopUpOrder.mockRejectedValue({ code: "TOO_MANY_PENDING" });
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    await clickNext();
    await flush();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.tooManyPending"));
  });

  it("轮询每周期只发一次请求（换外壳不产生重复轮询）", async () => {
    seedCloud(TOKEN);
    vi.useFakeTimers();
    api.getTopUpOrder.mockResolvedValue(orderStatus());
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();

    expect(
      api.getTopUpOrder,
      "进入 waiting 立刻轮询一次",
    ).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.getTopUpOrder, "一个间隔只多一次").toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.getTopUpOrder).toHaveBeenCalledTimes(3);
  });

  it("关闭重开后：旧订单的迟到结果不回写新会话", async () => {
    seedCloud(TOKEN);
    let resolvePoll!: (value: OrderStatus) => void;
    api.getTopUpOrder.mockReturnValue(
      new Promise<OrderStatus>((resolve) => {
        resolvePoll = resolve;
      }),
    );
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();

    await closeTopUp();
    await openTopUp();
    expect(dialog()?.textContent, "重开回到金额步").toContain(
      i18n.t("topUp.amountLabel"),
    );

    // 关窗后旧轮询的迟到结果（confirmed）
    await act(async () => {
      resolvePoll(
        orderStatus({ status: "confirmed", credited_micro_usd: 10_000_000 }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    expect(
      dialog()?.textContent,
      "旧订单结果不能把新会话推进到 waiting/成功",
    ).not.toContain(i18n.t("topUp.waitingTitle"));
    expect(api.getMe, "旧订单确认不该触发余额刷新").not.toHaveBeenCalled();
  });

  it("关闭重开后：旧会话迟到的 poll credited 不写进新会话（generation 与 cancelled 同门）", async () => {
    seedCloud(TOKEN);
    // 旧会话（order-1）的 poll 挂起；新会话（order-2）的 poll 立刻 confirmed，但服务端没给有效
    // credited ⇒ 新会话展示「金额同步中」。此时让旧 poll 带 credited=99_000_000 settle：
    // 若 credited 回写只挡 cancelled、不挡代际（或完全不挡），会把旧会话金额亮进新会话。
    let resolveOldPoll!: (value: OrderStatus) => void;
    api.getTopUpOrder.mockImplementation((id: string) =>
      id === "order-1"
        ? new Promise<OrderStatus>((resolve) => {
            resolveOldPoll = resolve;
          })
        : Promise.resolve(
            orderStatus({
              id: "order-2",
              status: "confirmed",
              credited_micro_usd: Number.NaN,
            }),
          ),
    );
    api.createTopUpOrder
      .mockResolvedValueOnce(createdOrder())
      .mockResolvedValue(
        createdOrder({ id: "order-2", deposit_address: "0xNEW" }),
      );
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting(); // 旧会话 waiting：order-1 的 poll 挂起
    expect(api.getTopUpOrder).toHaveBeenCalledWith("order-1");

    await closeTopUp();
    await openTopUp();
    await gotoWaiting(); // 新会话 waiting：order-2 立刻 confirmed、credited 未知
    await flush();
    expect(
      dialog()?.textContent,
      "前置：新会话必须停在 confirmed 且金额未知",
    ).toContain(i18n.t("topUp.confirmedAmountPending"));

    await act(async () => {
      resolveOldPoll(
        orderStatus({
          id: "order-1",
          status: "confirmed",
          credited_micro_usd: 99_000_000,
        }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    expect(
      dialog()?.textContent,
      "旧会话迟到的 credited 不得写进新会话",
    ).toContain(i18n.t("topUp.confirmedAmountPending"));
    expect(dialog()?.textContent).not.toContain(
      i18n.t("topUp.confirmed", { usd: "$99.00" }),
    );
  });

  // ── 以下 6 条把 review round1 的两条 PROBE（既有缺陷）锁成**修复后的正确行为** ──
  // 修复前实测：PROBE-1 关闭后 15s 内旧轮询又多 3 次请求；PROBE-2 迟到 createOrder 回写重开会话。

  it("关闭后旧订单轮询被取消：15s 内不再请求", async () => {
    seedCloud(TOKEN);
    vi.useFakeTimers();
    api.getTopUpOrder.mockResolvedValue(orderStatus());
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();
    expect(api.getTopUpOrder).toHaveBeenCalledTimes(1);

    await closeTopUp();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(
      api.getTopUpOrder,
      "关闭后旧轮询必须被 abort（修复前这里会变成 4 次）",
    ).toHaveBeenCalledTimes(1);
  });

  it("关闭重开不重启旧订单轮询（reopen 不误发一次旧 poll）", async () => {
    seedCloud(TOKEN);
    vi.useFakeTimers();
    api.getTopUpOrder.mockResolvedValue(orderStatus());
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();
    expect(api.getTopUpOrder).toHaveBeenCalledTimes(1);

    await closeTopUp();
    // 重开那一帧里 step/order 还是旧的（reset effect 尚未落地）⇒ 只检查 open 会误发一次旧 poll
    await openTopUp();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.getTopUpOrder).toHaveBeenCalledTimes(1);
    expect(dialog()?.textContent).toContain(i18n.t("topUp.amountLabel"));
  });

  it("pending createOrder 迟到 resolve：不回写重开会话，creating 复位", async () => {
    seedCloud(TOKEN);
    let resolveCreate!: (value: CreatedOrder) => void;
    api.createTopUpOrder.mockReturnValue(
      new Promise<CreatedOrder>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    await clickNext(); // 下单挂起
    await closeTopUp();
    await openTopUp();

    await act(async () => {
      resolveCreate(createdOrder());
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    expect(dialog()?.textContent, "不得被旧订单推回 pay 步").toContain(
      i18n.t("topUp.amountLabel"),
    );
    expect(dialog()?.textContent).not.toContain("0xDEPOSITADDRESS");
    // creating 必须被重开复位，否则 chain 步的「下一步」永久禁用
    await typeAmount("100");
    await clickNext();
    expect(
      buttonByText(i18n.t("topUp.next")).disabled,
      "重开后 chain 步的下一步必须可用",
    ).toBe(false);
  });

  it("pending createOrder 迟到 reject：旧会话的错误不泄漏进重开会话的 chain 步", async () => {
    seedCloud(TOKEN);
    // ⚠️ 旧会话的 reject 必须落在**新会话的 chain 步**才看得见：networkError 横幅只在 chain 步渲染，
    // 停在 amount 步断言「不含 networkError」是假绿（amount 步从来不渲染它）。
    // 因此这里用两个 deferred：旧请求挂起 → 重开 → 新会话也停在 chain 步（新 createOrder 同样挂起）。
    let rejectOld!: (reason: unknown) => void;
    let resolveFresh!: (value: CreatedOrder) => void;
    api.createTopUpOrder
      .mockReturnValueOnce(
        new Promise<CreatedOrder>((_resolve, reject) => {
          rejectOld = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise<CreatedOrder>((resolve) => {
          resolveFresh = resolve;
        }),
      );
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    await clickNext(); // 旧会话下单挂起
    await closeTopUp();
    await openTopUp();

    await typeAmount("100");
    await clickNext(); // amount → chain
    await clickNext(); // chain → 新会话下单（同样挂起）
    expect(
      dialog()?.textContent,
      "前置：必须真的站在新会话的 chain 步",
    ).toContain(i18n.t("topUp.chainLabel"));
    expect(dialog()?.textContent).not.toContain(i18n.t("topUp.networkError"));

    await act(async () => {
      rejectOld(new Error("boom"));
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    expect(
      dialog()?.textContent,
      "旧会话的 reject 不得在新会话的 chain 步亮出 networkError",
    ).not.toContain(i18n.t("topUp.networkError"));
    expect(dialog()?.textContent).toContain(i18n.t("topUp.chainLabel"));

    // 清理：新会话自己的下单仍应正常推进到 pay 步（不是被旧 reject 影响）
    await act(async () => {
      resolveFresh(createdOrder());
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");
  });

  it("pending QRCode 迟到：不覆盖重开会话里新订单的二维码", async () => {
    seedCloud(TOKEN);
    // ⚠️ 假绿陷阱：重开回到 amount 步时根本没有 <img>，「不含 ZZZ」必然成立。
    // 必须先把**新会话**推进到 pay 步并拿到 fresh 二维码，再让旧 deferred settle：
    // 只有 visible fresh img 仍在、且 src 不是 ZZZ，才证明旧二维码被隔离。
    let resolveOldQr!: (value: string) => void;
    qr.toDataURL
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveOldQr = resolve;
        }),
      )
      .mockResolvedValue("data:image/png;base64,FRESH");
    api.createTopUpOrder
      .mockResolvedValueOnce(createdOrder())
      .mockResolvedValue(
        createdOrder({ id: "order-fresh", deposit_address: "0xFRESH" }),
      );
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    await clickNext(); // 旧订单已创建（pay 步），旧二维码还挂着
    await flush();
    await closeTopUp();
    await openTopUp();

    await typeAmount("100");
    await clickNext();
    await clickNext(); // 新会话的订单 + 新二维码（mockResolvedValue 立即返回 FRESH）
    await flush();
    expect(
      dialog()?.querySelector<HTMLImageElement>('img[src*="FRESH"]'),
      "前置：新会话必须真的渲染出 fresh 二维码",
    ).not.toBeNull();

    await act(async () => {
      resolveOldQr("data:image/png;base64,ZZZ");
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    const img = dialog()?.querySelector<HTMLImageElement>("img");
    expect(img, "pay 步必须仍有二维码").not.toBeNull();
    expect(
      img?.getAttribute("src"),
      "迟到的旧二维码不得覆盖/清掉新会话的二维码",
    ).toContain("FRESH");
    expect(img?.getAttribute("src")).not.toContain("ZZZ");
  });

  it("换 token：清掉旧 order；迟到 QRCode 不覆盖新 token 会话里新订单的二维码", async () => {
    seedCloud(TOKEN);
    // ⚠️ 同上的假绿陷阱：换 token 后停在 amount 步没有 <img>，「不含 ZZZ」无意义。
    // 先把新 token 会话推进到 pay 步拿到 fresh 二维码，再 settle 旧 token 的 deferred。
    let resolveOldQr!: (value: string) => void;
    qr.toDataURL
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveOldQr = resolve;
        }),
      )
      .mockResolvedValue("data:image/png;base64,FRESH");
    api.createTopUpOrder
      .mockResolvedValueOnce(createdOrder())
      .mockResolvedValue(
        createdOrder({ id: "order-fresh", deposit_address: "0xFRESH" }),
      );
    await render(<TopUpModal />);
    await openTopUp();
    await gotoPay(); // 旧 order 已展示，旧 token 的二维码还挂着
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");

    // 换 token 而弹窗仍开着：代际已失效，若 reset 不跟着跑，poll 被挡住 ⇒ UI 冻结在旧订单上
    await act(async () => {
      useAppStore.getState().setCloudConfig({
        serverUrl: "https://cloud.example",
        token: "another-token",
        isLoggedIn: true,
        email: "me@example.com",
        level: "free",
        balanceMicroUsd: 0,
      });
    });
    await flush();

    expect(
      dialog()?.textContent,
      "换 token 必须清掉上一个会话的 order",
    ).toContain(i18n.t("topUp.amountLabel"));
    expect(dialog()?.textContent).not.toContain("0xDEPOSITADDRESS");

    // 新 token 会话走到 pay 步，拿到自己的二维码
    await gotoPay();
    expect(
      dialog()?.querySelector<HTMLImageElement>('img[src*="FRESH"]'),
      "前置：新 token 会话必须真的渲染出 fresh 二维码",
    ).not.toBeNull();

    await act(async () => {
      resolveOldQr("data:image/png;base64,ZZZ");
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    const img = dialog()?.querySelector<HTMLImageElement>("img");
    expect(img, "pay 步必须仍有二维码").not.toBeNull();
    expect(
      img?.getAttribute("src"),
      "旧 token 的迟到二维码不得覆盖/清掉新会话的二维码",
    ).toContain("FRESH");
    expect(img?.getAttribute("src")).not.toContain("ZZZ");
  });

  it("换 token：挂起的 createOrder 不再写 UI，creating 被复位", async () => {
    seedCloud(TOKEN);
    let resolveCreate!: (value: CreatedOrder) => void;
    api.createTopUpOrder.mockReturnValue(
      new Promise<CreatedOrder>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    await render(<TopUpModal />);
    await openTopUp();
    await typeAmount("100");
    await clickNext();
    await clickNext(); // 下单挂起（creating = true）

    await act(async () => {
      useAppStore.getState().setCloudConfig({
        serverUrl: "https://cloud.example",
        token: "another-token",
        isLoggedIn: true,
        email: "me@example.com",
        level: "free",
        balanceMicroUsd: 0,
      });
    });
    await flush();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.amountLabel"));

    await act(async () => {
      resolveCreate(createdOrder());
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();
    expect(dialog()?.textContent).not.toContain("0xDEPOSITADDRESS");

    // creating 必须被复位，否则新 token 下 chain 步的「下一步」永久禁用
    await typeAmount("100");
    await clickNext();
    expect(
      buttonByText(i18n.t("topUp.next")).disabled,
      "换 token 后 chain 步的下一步必须可用",
    ).toBe(false);
  });

  it("同 token 的余额更新不重置业务状态（cloudApi 复用同一实例）", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();
    await gotoPay();
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");

    await act(async () => {
      const snapshot = useAppStore.getState().cloudConfig!;
      useAppStore.getState().setCloudConfig({
        ...snapshot,
        balanceMicroUsd: 12_345_678,
      });
    });
    await flush();

    expect(
      dialog()?.textContent,
      "同一 token 只换余额快照：不得重置到金额步",
    ).toContain("0xDEPOSITADDRESS");
    expect(dialog()?.querySelector('input[inputmode="decimal"]')).toBeNull();
  });

  it("pending 已确认 getMe 迟到：不刷新余额、不翻转支付状态", async () => {
    seedCloud(TOKEN);
    api.getTopUpOrder.mockResolvedValue(
      orderStatus({ status: "confirmed", credited_micro_usd: 10_000_000 }),
    );
    let resolveMe!: (value: Me) => void;
    api.getMe.mockReturnValue(
      new Promise<Me>((resolve) => {
        resolveMe = resolve;
      }),
    );
    await render(<TopUpModal />);
    await openTopUp();
    await gotoWaiting();
    await flush(); // 轮询已 confirmed，卡在 getMe
    expect(api.getMe).toHaveBeenCalledTimes(1);

    await closeTopUp();
    await openTopUp();
    await act(async () => {
      resolveMe(me(25_000_000));
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    expect(
      useAppStore.getState().cloudConfig?.balanceMicroUsd,
      "旧确认的 getMe 迟到不得写余额",
    ).toBe(0);
    expect(dialog()?.textContent).toContain(i18n.t("topUp.amountLabel"));
    expect(dialog()?.textContent).not.toContain(i18n.t("topUp.waitingTitle"));
  });
});

describe("TopUpModal 回焦", () => {
  it("关闭后焦点回到打开前的元素", async () => {
    seedCloud(TOKEN);
    await render(<Harness />);
    const opener = container.querySelector<HTMLButtonElement>(
      '[data-testid="opener"]',
    )!;
    opener.focus();
    expect(document.activeElement).toBe(opener);
    await click(opener);
    await flush();
    expect(dialog()).not.toBeNull();

    await clickOverlay();
    expect(useAppStore.getState().topUpOpen).toBe(false);
    expect(document.activeElement, "关闭后必须回到 opener").toBe(opener);
  });

  it("事件类入口（打开时 body 无焦点）走 onRestoreFocus fallback", async () => {
    seedCloud(TOKEN);
    const onRestoreFocus = vi.fn();
    await render(<Harness onRestoreFocus={onRestoreFocus} />);
    const opener = container.querySelector<HTMLButtonElement>(
      '[data-testid="opener"]',
    )!;
    // jsdom 的 click 不会自动聚焦 ⇒ 打开瞬间 activeElement 仍是 body（事件入口的形态）。
    // 注意断言时机：Radix 打开后会把焦点移进弹窗，所以不能在这里断言 activeElement 仍是 body，
    // 只能断言「焦点没有被 opener 拿走」。
    await click(opener);
    await flush();
    expect(
      document.activeElement,
      "打开时没有可回焦的有效目标（焦点不该在 opener 上）",
    ).not.toBe(opener);
    expect(dialog()?.contains(document.activeElement)).toBe(true);

    await clickOverlay();
    expect(
      onRestoreFocus,
      "没有有效返回目标时用父级 fallback",
    ).toHaveBeenCalledTimes(1);
    const fallback = container.querySelector('[data-testid="fallback"]');
    expect(document.activeElement, "fallback 节点必须拿到焦点").toBe(fallback);
  });

  it("Tab 边界：最后一个 tabbable 上按 Tab 回绕到第一个（FocusScope 边界）", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();
    const el = dialog();
    expect(el).not.toBeNull();

    const nodes = tabbables(el as HTMLElement);
    expect(
      nodes.length,
      "弹窗里必须有多个可聚焦项才谈得上边界",
    ).toBeGreaterThan(1);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    last.focus();
    expect(document.activeElement, "先站在最后一个 tabbable 上").toBe(last);
    await act(async () => {
      last.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();

    // 回填后的「第一个」是 TabsList（RovingFocusGroup 的容器，tabindex=0）；
    // 它在键盘焦点落到容器上时会把焦点转交给当前 tab stop —— 所以真实的落点是
    // 「当前选中的页签」而不是 tablist 节点本身。边界仍是同一处，只是落点更具体。
    expect(first.getAttribute("role"), "第一个 tabbable 是页签容器").toBe(
      "tablist",
    );
    const activeTab = (el as HTMLElement).querySelector(
      '[role="tab"][aria-selected="true"]',
    );
    expect(activeTab, "当前选中的页签必须存在").not.toBeNull();
    expect(
      document.activeElement,
      "最后一个 tabbable 上 Tab 必须回绕到页签容器（转交给当前 tab）",
    ).toBe(activeTab);
  });
});

/**
 * App 侧的回焦接线（源码扫描，不整棵渲染 App —— 与 Task 1 的 SettingsSkills 接线同一条理由）。
 */
describe("App 的充值回焦接线", () => {
  const src = (): string =>
    fs.readFileSync(path.join(RENDERER, "App.tsx"), "utf8");

  it("现有 <main> 是可聚焦的 fallback（ref + tabIndex=-1），不隐藏原生焦点", () => {
    const source = src();
    expect(source.length).toBeGreaterThan(1000);
    expect(source, "main 必须是 ref=mainRef + tabIndex=-1").toMatch(
      /ref=\{mainRef\}\s+tabIndex=\{-1\}/,
    );
    expect(source, "mainRef 必须是 HTMLElement ref").toContain(
      "const mainRef = useRef<HTMLElement>(null)",
    );
    const start = source.search(/ref=\{mainRef\}/);
    expect(start, "找不到 main 的 ref").toBeGreaterThan(-1);
    const tag = source.slice(start, source.indexOf(">", start));
    expect(tag, "main 不得隐藏原生焦点可见性").not.toContain("outline");
  });

  it("TopUpModal 传 onRestoreFocus → 聚焦 main（preventScroll）", () => {
    expect(src()).toContain(
      "onRestoreFocus={() => mainRef.current?.focus({ preventScroll: true })}",
    );
  });
});

/**
 * 原生入口回焦的最小同构父级：真实 AccountMenu（受控 open）+ 局部 ref 暂存原账号 Button +
 * 真实 TopUpModal。等价 App → AppRail → AccountCluster 的接线（不整棵渲染 App，也不 mock 原语）。
 *
 * 真实 Electron 焦点轨迹（out/shadcn-plan-13/task2-focus/focus-trace.json）证明两处缺陷：
 *   ① 余额行打开充值弹窗时，Radix 菜单退场的默认 close-autofocus 会尝试抢回 Trigger，
 *      随即被 Dialog FocusScope 弹回；
 *   ② Escape 关闭后 activeElement 落到 App <main> fallback，而不是原账号 Trigger。
 * 本组用例用真实原语盯住修复后的行为，而不是只扫源码。
 */
function ParentHarness({
  onOpenTopUpSpy,
  takeReturnFocusTarget,
}: {
  onOpenTopUpSpy?: (target: HTMLButtonElement | null) => void;
  takeReturnFocusTarget?: () => HTMLElement | null;
} = {}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingTriggerRef = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <AccountMenu
        trigger={
          <button type="button" aria-label={i18n.t("sidebar.user")}>
            VB
          </button>
        }
        open={menuOpen}
        onOpenChange={setMenuOpen}
        cloudConfig={{
          serverUrl: "https://cloud.example",
          token: TOKEN,
          isLoggedIn: true,
          email: "me@example.com",
          level: "free",
          balanceMicroUsd: 12_340_000,
        }}
        onOpenTopUp={(target) => {
          onOpenTopUpSpy?.(target);
          pendingTriggerRef.current = target;
          useAppStore.getState().setTopUpOpen(true);
        }}
        onOpenLogin={() => {}}
        onOpenSettings={() => {}}
        onLogout={() => {}}
      />
      <div ref={fallbackRef} data-testid="focus-fallback" tabIndex={-1} />
      <TopUpModal
        takeReturnFocusTarget={
          takeReturnFocusTarget ??
          (() => {
            const target = pendingTriggerRef.current;
            pendingTriggerRef.current = null;
            return target;
          })
        }
        onRestoreFocus={() =>
          fallbackRef.current?.focus({ preventScroll: true })
        }
      />
    </>
  );
}

function accountTrigger(): HTMLButtonElement {
  const el = document.body.querySelector<HTMLButtonElement>(
    `button[aria-label="${i18n.t("sidebar.user")}"]`,
  );
  if (!el) throw new Error("账号 Trigger 必须存在");
  return el;
}

async function openAccountMenu(): Promise<void> {
  await pointerDown(accountTrigger());
  await flush();
}

async function activateBalance(): Promise<void> {
  const row = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.includes(i18n.t("accountMenu.balance")));
  if (!row) throw new Error("余额菜单行必须存在");
  await click(row);
  await flush();
}

describe("原生入口回焦：AccountMenu → TopUpDialog（真实原语集成）", () => {
  it("pointerdown 一次开菜单 → 激活余额行：Dialog 内真实焦点，菜单退场不抢回 Trigger", async () => {
    seedCloud(TOKEN);
    const seen: (HTMLButtonElement | null)[] = [];
    await render(<ParentHarness onOpenTopUpSpy={(t) => seen.push(t)} />);
    const trigger = accountTrigger();
    const triggerFocus: Event[] = [];
    trigger.addEventListener("focus", (e) => triggerFocus.push(e));

    await openAccountMenu();
    expect(
      document.body.querySelector('[role="menu"]'),
      "pointerdown 应打开账号菜单",
    ).not.toBeNull();

    await activateBalance();
    const el = dialog();
    expect(el, "激活余额行必须打开充值 Dialog").not.toBeNull();
    expect(useAppStore.getState().topUpOpen).toBe(true);
    expect(
      document.body.querySelector('[role="menu"]'),
      "菜单必须退场",
    ).toBeNull();
    expect(seen, "onOpenTopUp 必须拿到真实 Trigger 元素").toEqual([trigger]);
    expect(document.activeElement, "焦点不能停在 body").not.toBe(document.body);
    expect(
      el!.contains(document.activeElement),
      "Dialog 必须接管真实焦点",
    ).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
    expect(
      triggerFocus,
      "充值转场时菜单退场不得把焦点抢回 Trigger",
    ).toHaveLength(0);
  });

  it("Escape 关闭后焦点回到原账号 Button（不是 <main> fallback）", async () => {
    seedCloud(TOKEN);
    await render(<ParentHarness />);
    const trigger = accountTrigger();
    await openAccountMenu();
    await activateBalance();
    expect(dialog()).not.toBeNull();

    await pressEscape();
    await flush();

    expect(useAppStore.getState().topUpOpen).toBe(false);
    expect(dialog()).toBeNull();
    expect(
      document.activeElement,
      "Escape 关闭后必须回到打开前的账号入口",
    ).toBe(trigger);
  });

  it("原 Button 被 disable 后关闭：走父级 fallback 并真实拿到焦点", async () => {
    seedCloud(TOKEN);
    await render(<ParentHarness />);
    const trigger = accountTrigger();
    await openAccountMenu();
    await activateBalance();
    expect(dialog()).not.toBeNull();

    trigger.disabled = true;
    await pressEscape();
    await flush();

    const fallback = container.querySelector('[data-testid="focus-fallback"]');
    expect(
      document.activeElement,
      "原入口不可聚焦时必须落到父级 fallback（<main> 的替身）",
    ).toBe(fallback);
  });

  it("注入失效（已卸载）的 Trigger：仍走父级 fallback 并真实拿到焦点", async () => {
    seedCloud(TOKEN);
    await render(
      <ParentHarness
        takeReturnFocusTarget={() => document.createElement("button")}
      />,
    );
    await openAccountMenu();
    await activateBalance();
    expect(dialog()).not.toBeNull();

    await pressEscape();
    await flush();

    const fallback = container.querySelector('[data-testid="focus-fallback"]');
    expect(document.activeElement).toBe(fallback);
  });
});

describe("原生回焦的工艺透传（源码 pin）", () => {
  const src = (rel: string): string =>
    fs.readFileSync(path.join(RENDERER, rel), "utf8");

  it("AccountCluster / AppRail 只做 typed optional callback 透传（不碰 Sidebar）", () => {
    const cluster = src("components/AccountCluster.tsx");
    expect(cluster).toContain(
      "onOpenTopUp?: (target: HTMLButtonElement | null) => void",
    );
    expect(cluster).toContain("onOpenTopUp={onOpenTopUp}");

    const rail = src("components/AppRail.tsx");
    expect(rail).toContain(
      "onOpenTopUp?: (target: HTMLButtonElement | null) => void",
    );
    expect(rail).toContain("<AccountCluster onOpenTopUp={onOpenTopUp} />");
  });

  it("App：局部 ref 暂存原入口 + takeReturnFocusTarget 读取即清", () => {
    const app = src("App.tsx");
    expect(app).toContain(
      "const topUpTriggerRef = useRef<HTMLElement | null>(null)",
    );
    expect(app).toContain("onOpenTopUp={(target) => {");
    expect(app).toContain("topUpTriggerRef.current = target;");
    expect(app).toContain("takeReturnFocusTarget={() => {");
    expect(app).toContain("const target = topUpTriggerRef.current;");
    expect(app).toContain("topUpTriggerRef.current = null;");
  });

  it("AccountMenu：ref 挂现有 Trigger + 只在充值转场抑制退场回焦", () => {
    const menu = src("components/AccountMenu.tsx");
    expect(menu).toContain(
      "const triggerRef = useRef<HTMLButtonElement>(null)",
    );
    expect(menu).toMatch(/<DropdownMenuTrigger asChild ref=\{triggerRef\}>/);
    expect(menu).toContain("onCloseAutoFocus");
    expect(menu).toContain("if (openingTopUpRef.current) {");
    expect(menu).toContain("event.preventDefault();");
  });
});

describe("TopUpModal 页签（ui/tabs 语义与滚动归属）", () => {
  // 迁移前是 header 里两个手绘 Button + `tab === "topup"` 条件渲染：没有
  // role=tablist/tab/tabpanel、没有 aria-selected、没有方向键语义。这里锁原语接管后的行为，
  // 并保住布局归属：固定高度面板是 Tabs Root（asChild 合并到 DialogContent），
  // 滚动/flex/gap 归各 TabsContent —— 面板自己不 flex-1，避免双重滚动条。
  const PANEL_CLASSES = [
    "mt-4",
    "flex",
    "min-h-0",
    "flex-1",
    "flex-col",
    "gap-4",
    "overflow-y-auto",
    "px-6",
    "pb-6",
  ];

  const tabs = (): HTMLElement[] => [
    ...document.body.querySelectorAll<HTMLElement>('[role="tab"]'),
  ];
  const tabByLabel = (label: string): HTMLElement => {
    const tab = tabs().find((el) => (el.textContent ?? "").trim() === label);
    if (!tab) throw new Error(`弹窗里找不到页签「${label}」`);
    return tab;
  };
  /** Radix 把非当前值面板留在 DOM 里但打 `hidden` 且不渲染 children。 */
  const panels = (): HTMLElement[] => [
    ...document.body.querySelectorAll<HTMLElement>(
      '[role="tabpanel"]:not([hidden])',
    ),
  ];
  const hiddenPanels = (): HTMLElement[] => [
    ...document.body.querySelectorAll<HTMLElement>('[role="tabpanel"][hidden]'),
  ];
  const selected = (): HTMLElement[] =>
    tabs().filter((el) => el.getAttribute("aria-selected") === "true");
  const panel = (): HTMLElement => {
    const found = panels();
    expect(found, "当前值只有一个可见面板").toHaveLength(1);
    expect(
      hiddenPanels().map((el) => el.childElementCount),
      "非当前值面板只留 hidden 壳，children 不挂载",
    ).toEqual([0]);
    return found[0];
  };

  /** Radix 的 TabsTrigger 在 mousedown（主键、非 ctrl）上激活，不是 click。 */
  const pressTab = async (el: Element): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };

  const pressKey = async (el: Element, key: string): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };

  it("唯一 tablist 两个 tab；面板按值挂载并各自接管滚动区，Root 不重复滚动", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();

    expect(
      document.body.querySelectorAll('[role="tablist"]'),
      "页签容器必须唯一",
    ).toHaveLength(1);
    expect(tabs().map((el) => (el.textContent ?? "").trim())).toEqual([
      i18n.t("topUp.topupTab"),
      i18n.t("topUp.historyTab"),
    ]);
    const topup = tabByLabel(i18n.t("topUp.topupTab"));
    expect(selected()).toEqual([topup]);

    const topupPanel = panel();
    expect(topupPanel.getAttribute("aria-labelledby")).toBe(topup.id);
    expect(topup.getAttribute("aria-controls")).toBe(topupPanel.id);
    for (const cls of PANEL_CLASSES) {
      expect(
        topupPanel.className.split(/\s+/),
        `面板要接管滚动区样式（缺 ${cls}）`,
      ).toContain(cls);
    }

    // Root 就是固定高度面板：高度/皮肤在它上面，滚动不在它上面
    const root = dialog();
    expect(root).not.toBeNull();
    for (const cls of ["h-[600px]", "max-h-[85vh]", "flex", "flex-col"]) {
      expect(root!.className.split(/\s+/)).toContain(cls);
    }
    expect(root!.className, "Root 不加 flex-1").not.toContain("flex-1");
    expect(root!.className, "滚动归面板，Root 不得再滚一层").not.toContain(
      "overflow-y-auto",
    );

    await pressTab(tabByLabel(i18n.t("topUp.historyTab")));
    expect(selected()).toEqual([tabByLabel(i18n.t("topUp.historyTab"))]);
    const historyPanel = panel();
    expect(historyPanel.getAttribute("aria-labelledby")).toBe(
      tabByLabel(i18n.t("topUp.historyTab")).id,
    );
    for (const cls of PANEL_CLASSES) {
      expect(
        historyPanel.className.split(/\s+/),
        `历史面板同样接管滚动区（缺 ${cls}）`,
      ).toContain(cls);
    }
    expect(
      dialog()?.textContent,
      "切到记录后充值面板必须卸载（不 forceMount）",
    ).not.toContain(i18n.t("topUp.subtitle"));
    expect(document.body.textContent).toContain(i18n.t("topUp.historyTab"));
  });

  it("方向键只移焦点（manual），Enter 才激活；点击也能切回充值", async () => {
    seedCloud(TOKEN);
    await render(<TopUpModal />);
    await openTopUp();

    const topup = tabByLabel(i18n.t("topUp.topupTab"));
    topup.focus();
    await pressKey(topup, "ArrowRight");
    const history = tabByLabel(i18n.t("topUp.historyTab"));
    expect(document.activeElement).toBe(history);
    expect(selected(), "manual 模式下箭头只移焦点，不得立刻挂载另一页").toEqual(
      [topup],
    );

    await pressKey(history, "Enter");
    expect(selected()).toEqual([history]);
    expect(dialog()?.textContent).not.toContain(i18n.t("topUp.subtitle"));

    await pressKey(history, "ArrowLeft");
    expect(document.activeElement).toBe(topup);
    expect(selected(), "回到充值页签上仍是记录在显示").toEqual([history]);

    await pressTab(topup);
    expect(selected()).toEqual([topup]);
    expect(dialog()?.textContent).toContain(i18n.t("topUp.subtitle"));
  });

  it("支付等待中来回切页签：订单/金额保留，不重复下单、不重启轮询", async () => {
    seedCloud(TOKEN);
    vi.useFakeTimers();
    api.getTopUpOrder.mockResolvedValue(orderStatus());
    await render(<TopUpModal />);
    await openTopUp();
    await gotoPay();

    expect(api.createTopUpOrder).toHaveBeenCalledTimes(1);
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");
    expect(dialog()?.textContent, "确认金额按订单金额展示").toContain(
      "100.000000",
    );

    const history = tabByLabel(i18n.t("topUp.historyTab"));
    const topup = tabByLabel(i18n.t("topUp.topupTab"));
    await pressTab(history);
    await pressTab(topup);
    await pressTab(history);
    await pressTab(topup);

    expect(
      api.createTopUpOrder,
      "来回切页签不得创建新单",
    ).toHaveBeenCalledTimes(1);
    expect(dialog()?.textContent).toContain("0xDEPOSITADDRESS");
    expect(dialog()?.textContent).toContain("100.000000");

    // 进入 waiting 起轮询：切页签不得重启/重复轮询
    await clickNext();
    await flush();
    expect(dialog()?.textContent).toContain(i18n.t("topUp.waitingTitle"));
    const polls = api.getTopUpOrder.mock.calls.length;
    expect(polls, "进入 waiting 立刻轮询一次").toBe(1);
    await pressTab(history);
    await pressTab(topup);
    expect(api.getTopUpOrder, "切页签不得重启轮询").toHaveBeenCalledTimes(
      polls,
    );
    expect(api.getTopUpOrder).toHaveBeenCalledWith("order-1");
    expect(dialog()?.textContent, "waiting 步状态保留").toContain(
      i18n.t("topUp.waitingTitle"),
    );
  });
});
