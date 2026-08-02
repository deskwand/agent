export const TOPUP_MIN_CENTS = 200; // $2
export const TOPUP_MAX_CENTS = 20000; // $200
export const POLL_INTERVAL_MS = 5000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟（订单 30 分钟有效，留足余量）

export type TopUpOrderStatus = "pending" | "confirmed" | "expired";
export type TopUpWaitResult = "confirmed" | "expired" | "timeout" | "error";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function creditsForAmountCents(cents: number): number {
  return cents * 10; // 1 credit = $0.001
}

/** 轮询订单状态：confirmed/expired 立即返回；网络错误退避重试；超时返回 timeout */
export async function waitForOrderConfirmation(
  poll: (orderId: string) => Promise<TopUpOrderStatus>,
  orderId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<TopUpWaitResult> {
  const { intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) return "timeout";
    let status: TopUpOrderStatus;
    try {
      status = await poll(orderId);
    } catch {
      await sleep(Math.min(intervalMs * 2, 30000)); // 退避上限 30s
      continue;
    }
    if (status === "confirmed") return "confirmed";
    if (status === "expired") return "expired";
    await sleep(intervalMs);
  }
}
