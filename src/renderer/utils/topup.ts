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

/** 1 credit = $0.001；与服务端充值入账公式（$1 = 1000 credits）严格一致，勿单独调整 */
const CREDITS_PER_USD = 1000;

/** credits → 美元展示串：四舍五入到分；不足 $0.005 → "<$0.01"；0 → "$0.00" */
export function usdForCredits(credits: number): string {
  const usd = credits / CREDITS_PER_USD;
  if (usd <= 0) return "$0.00";
  const cents = Math.round(usd * 100);
  if (cents <= 0) return "<$0.01";
  return `$${(cents / 100).toFixed(2)}`;
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
