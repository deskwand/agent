export const TOPUP_MIN_CENTS = 200; // $2
export const TOPUP_MAX_CENTS = 20000; // $200
export const POLL_INTERVAL_MS = 5000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟（订单 30 分钟有效，留足余量）

export type TopUpOrderStatus = "pending" | "confirmed" | "expired";
export type TopUpWaitResult =
  | "confirmed"
  | "expired"
  | "timeout"
  | "error"
  /** renderer 内部用：signal 被 abort（弹窗关闭 / 换会话）⇒ 调用点直接丢弃结果，不走 UI 错误分支 */
  | "cancelled";

/**
 * 可中断的等待。
 *
 * 为什么不用裸 `setTimeout`：弹窗关闭后旧订单的轮询必须**停下来**（review round1 的
 * PROBE-1：关闭后 15s 内还在每 5s 打一次 `/api/payments/orders/:id`）—— abort 后循环不再发下一次
 * poll，正在进行的 sleep/backoff 也被打断。中断时清掉 timer 并移除 abort 监听，避免留下悬空
 * 定时器/监听器（pending 的正常等待与网络错误后的 backoff 同款）。
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort);
  });
}

/** "$12.34" / "12.34" / "$5" → 1234 / 1234 / 500；越界或非法 → null */
export function parseAmountToCents(input: string): number | null {
  const trimmed = input.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (
    !Number.isSafeInteger(cents) ||
    cents < TOPUP_MIN_CENTS ||
    cents > TOPUP_MAX_CENTS
  ) {
    return null;
  }
  return cents;
}

/**
 * 轮询订单状态：confirmed/expired 立即返回；网络错误退避重试；超时返回 timeout。
 *
 * 传入 `signal` 后，abort 会**停止后续 poll** 并打断正在进行中的 sleep/backoff（随即返回
 * `cancelled`：不把订单假称 expired、也不走 error 分支）。
 *
 * ⚠️ 作用域要说准：**正在等待的那次服务请求不会被取消** —— `CloudApiClient` 没有接收 signal，
 * 已经在飞的 `poll()` Promise 仍会 settle，只是它的结果随后被调用点丢弃。
 */
export async function waitForOrderConfirmation(
  poll: (orderId: string) => Promise<TopUpOrderStatus>,
  orderId: string,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TopUpWaitResult> {
  const {
    intervalMs = POLL_INTERVAL_MS,
    timeoutMs = POLL_TIMEOUT_MS,
    signal,
  } = opts;
  if (signal?.aborted) return "cancelled";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return "cancelled";
    if (Date.now() > deadline) return "timeout";
    let status: TopUpOrderStatus;
    try {
      status = await poll(orderId);
    } catch {
      if (signal?.aborted) return "cancelled";
      await sleep(Math.min(intervalMs * 2, 30000), signal); // 退避上限 30s
      continue;
    }
    if (signal?.aborted) return "cancelled";
    if (status === "confirmed") return "confirmed";
    if (status === "expired") return "expired";
    await sleep(intervalMs, signal);
  }
}

/**
 * 微美元（1e-6 USD）→ 展示串：四舍五入到分；不足 $0.005 → "<$0.01"；0 → "$0.00"。
 * 非有限值（服务端字段缺失时为 undefined/NaN）退化成 "—"，避免把 "$NaN" 渲染到界面上。
 */
export function formatMicroUsd(microUsd: number): string {
  if (!Number.isFinite(microUsd)) return "—";
  if (microUsd === 0) return "$0.00";
  const sign = microUsd < 0 ? "-" : "";
  const cents = Math.round(Math.abs(microUsd) / 10_000);
  if (cents === 0) return `${sign}<$0.01`;
  return `${sign}$${(cents / 100).toFixed(2)}`;
}

/** 按链构造区块浏览器交易链接（bscscan / arbiscan / basescan） */
export function explorerTxUrl(
  chain: "bsc" | "arb" | "base",
  txHash: string,
): string {
  const base = {
    bsc: "https://bscscan.com/tx/",
    arb: "https://arbiscan.io/tx/",
    base: "https://basescan.org/tx/",
  }[chain];
  return `${base}${txHash}`;
}

/** SQLite UTC 时间（"YYYY-MM-DD HH:MM:SS"）→ 本地化展示串；非法输入原样返回 */
export function formatTopUpTime(sqliteUtc: string): string {
  const d = new Date(sqliteUtc.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? sqliteUtc : d.toLocaleString();
}
