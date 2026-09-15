import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { useAppStore } from "../store";
import { CloudApiClient } from "../services/cloud-api";
import {
  formatMicroUsd,
  parseAmountToCents,
  waitForOrderConfirmation,
} from "../utils/topup";
import { TopUpHistory } from "./TopUpHistory";

type Step = "amount" | "chain" | "pay" | "waiting";
type PayStatus =
  | "idle"
  | "confirmed"
  | "orderExpired"
  | "timeout"
  | "tooManyPending"
  | "networkError";

const QUICK_AMOUNTS = [500, 1000, 2500, 5000]; // $5 / $10 / $25 / $50（美分）

export function TopUpModal() {
  const { t } = useTranslation();
  const topUpOpen = useAppStore((s) => s.topUpOpen);
  const setTopUpOpen = useAppStore((s) => s.setTopUpOpen);
  const cloudConfig = useAppStore((s) => s.cloudConfig);

  const cloudApi = useMemo(
    () => (cloudConfig?.token ? new CloudApiClient(cloudConfig.token) : null),
    [cloudConfig?.token],
  );

  const [step, setStep] = useState<Step>("amount");
  const [amountInput, setAmountInput] = useState("");
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [chain, setChain] = useState<"bsc" | "arb" | "base">("bsc");
  const [order, setOrder] = useState<{
    id: string;
    deposit_address: string;
    expires_at: string;
    amount_cents: number;
  } | null>(null);
  const [payStatus, setPayStatus] = useState<PayStatus>("idle");
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"topup" | "history">("topup");
  /** 服务端记录的实际到账金额；未知时不做任何推断 */
  const [creditedMicroUsd, setCreditedMicroUsd] = useState<number | null>(null);

  // 打开时重置
  useEffect(() => {
    if (topUpOpen) {
      setStep("amount");
      setAmountInput("");
      setAmountCents(null);
      setChain("bsc");
      setOrder(null);
      setPayStatus("idle");
      setCopied(false);
      setQrDataUrl("");
      setTab("topup");
      setCreditedMicroUsd(null);
    }
  }, [topUpOpen]);

  // 等待确认轮询（必须在 early return 之前——hooks 规则）
  useEffect(() => {
    if (step !== "waiting" || !order || !cloudApi) return;
    let cancelled = false;
    (async () => {
      const result = await waitForOrderConfirmation(
        (id) =>
          cloudApi.getTopUpOrder(id).then((o) => {
            const credited =
              Number.isSafeInteger(o.credited_micro_usd) &&
              o.credited_micro_usd >= 0
                ? o.credited_micro_usd
                : null;
            // 轮询被取消时不能把上一个订单的金额写进当前会话
            if (!cancelled && o.status === "confirmed") {
              setCreditedMicroUsd(credited);
            }
            return o.status;
          }),
        order.id,
      );
      if (cancelled) return;
      if (result === "confirmed") {
        try {
          const me = await cloudApi.getMe();
          const snapshot = useAppStore.getState().cloudConfig;
          if (snapshot) {
            useAppStore.getState().setCloudConfig({
              ...snapshot,
              balanceMicroUsd: me.balance_micro_usd,
            });
          }
        } catch {
          /* 余额刷新失败不阻塞成功提示 */
        }
        setPayStatus("confirmed");
      } else if (result === "expired") {
        setPayStatus("orderExpired");
      } else if (result === "timeout") {
        setPayStatus("timeout");
      } else {
        setPayStatus("networkError");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, order, cloudApi]);

  if (!topUpOpen || !cloudApi) return null;

  const parsedCents = parseAmountToCents(amountInput);
  // 以服务端创建的订单金额为准，避免展示金额与下单金额不一致
  const displayAmount = ((order?.amount_cents ?? amountCents ?? 0) / 100).toFixed(6);

  const createOrder = async () => {
    if (!cloudApi || parsedCents === null) return;
    setCreating(true);
    try {
      const created = await cloudApi.createTopUpOrder(parsedCents, chain);
      setOrder(created);
      setStep("pay");
      try {
        setQrDataUrl(await QRCode.toDataURL(created.deposit_address));
      } catch {
        setQrDataUrl("");
      }
    } catch (e: unknown) {
      // fetchCore 抛出的错误带 { code, status }（Error 对象属性），网络错误无 code
      const code = (e as { code?: unknown }).code;
      setPayStatus(
        code === "TOO_MANY_PENDING" ? "tooManyPending" : "networkError",
      );
    } finally {
      setCreating(false);
    }
  };

  const copyAddress = async () => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.deposit_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const startWaiting = () => {
    if (!order) return;
    setStep("waiting");
    setPayStatus("idle");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setTopUpOpen(false)}
    >
      <div
        className="flex h-[600px] max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4 px-6 pt-6">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("topUp.title")}
          </h2>
          <div className="flex gap-1 rounded-lg border border-border p-1">
            <button
              className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
                tab === "topup"
                  ? "bg-accent text-accent-foreground"
                  : "text-text-primary"
              }`}
              onClick={() => setTab("topup")}
            >
              {t("topUp.topupTab")}
            </button>
            <button
              className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
                tab === "history"
                  ? "bg-accent text-accent-foreground"
                  : "text-text-primary"
              }`}
              onClick={() => setTab("history")}
            >
              {t("topUp.historyTab")}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {tab === "topup" && (
            <p className="text-sm text-text-muted">{t("topUp.subtitle")}</p>
          )}

          {tab === "topup" && step === "amount" && (
            <>
              <label className="text-sm text-text-primary">
                {t("topUp.amountLabel")}
              </label>
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                placeholder={t("topUp.amountPlaceholder")}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                inputMode="decimal"
              />
              {amountInput !== "" && parsedCents === null && (
                <p className="text-sm text-error">{t("topUp.invalidAmount")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {QUICK_AMOUNTS.map((cents) => (
                  <button
                    key={cents}
                    className="rounded-full border border-border px-3 py-1 text-sm text-text-primary hover:border-accent"
                    onClick={() => setAmountInput((cents / 100).toFixed(2))}
                  >
                    ${cents / 100}
                  </button>
                ))}
              </div>
              <button
                className="w-full rounded-lg bg-accent py-2 text-sm text-accent-foreground disabled:opacity-40"
                disabled={parsedCents === null}
                onClick={() =>
                  parsedCents !== null &&
                  (setAmountCents(parsedCents), setStep("chain"))
                }
              >
                {t("topUp.next")}
              </button>
            </>
          )}

          {tab === "topup" && step === "chain" && (
            <>
              <label className="text-sm text-text-primary">
                {t("topUp.chainLabel")}
              </label>
              <div className="flex flex-col gap-2">
                {(["bsc", "arb", "base"] as const).map((c) => (
                  <button
                    key={c}
                    className={`rounded-lg border px-3 py-2 text-sm text-text-primary ${
                      chain === c ? "border-accent" : "border-border"
                    }`}
                    onClick={() => setChain(c)}
                  >
                    {c === "bsc"
                      ? t("topUp.chainBsc")
                      : c === "arb"
                        ? t("topUp.chainArb")
                        : t("topUp.chainBase")}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted">{t("topUp.chainHint")}</p>
              {payStatus === "networkError" && (
                <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-text-muted">
                  {t("topUp.networkError")}
                </p>
              )}
              {payStatus === "tooManyPending" && (
                <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-text-muted">
                  {t("topUp.tooManyPending")}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-lg border border-border py-2 text-sm text-text-primary"
                  onClick={() => setStep("amount")}
                >
                  {t("topUp.back")}
                </button>
                <button
                  className="flex-1 rounded-lg bg-accent py-2 text-sm text-accent-foreground"
                  disabled={creating}
                  onClick={createOrder}
                >
                  {t("topUp.next")}
                </button>
              </div>
            </>
          )}

          {tab === "topup" && step === "pay" && order && (
            <>
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-4">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR" className="h-40 w-40" />
                ) : (
                  <div className="h-40 w-40 rounded-lg bg-background/60" />
                )}
                <p className="text-xs text-text-muted">{t("topUp.qrHint")}</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-text-muted">
                  {t("topUp.addressLabel")}
                </span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-lg border border-border px-2 py-1.5 text-xs text-text-primary">
                    {order.deposit_address}
                  </code>
                  <button
                    className="rounded-lg border border-border px-2 py-1.5 text-xs text-text-primary"
                    onClick={copyAddress}
                  >
                    {copied ? t("topUp.copied") : t("topUp.copy")}
                  </button>
                </div>
                <span className="mt-2 text-sm text-text-muted">
                  {t("topUp.amountToSend")}
                </span>
                <span className="text-base font-semibold text-text-primary">
                  {displayAmount} {chain === "base" ? "USDC" : "USDT/USDC"}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                {t("topUp.payHint", { amount: displayAmount })}
              </p>
              <button
                className="w-full rounded-lg bg-accent py-2 text-sm text-accent-foreground"
                onClick={startWaiting}
              >
                {t("topUp.next")}
              </button>
            </>
          )}

          {tab === "topup" && step === "waiting" && (
            <>
              <p className="text-sm font-medium text-text-primary">
                {t("topUp.waitingTitle")}
              </p>
              <p className="text-sm text-text-muted">
                {t("topUp.waitingHint")}
              </p>
              {payStatus === "confirmed" && (
                <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                  {creditedMicroUsd === null
                    ? t("topUp.confirmedAmountPending")
                    : t("topUp.confirmed", {
                        usd: formatMicroUsd(creditedMicroUsd),
                      })}
                </p>
              )}
              {payStatus === "orderExpired" && (
                <p className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
                  {t("topUp.orderExpired")}
                </p>
              )}
              {payStatus === "timeout" && (
                <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-text-muted">
                  {t("topUp.timeout")}
                </p>
              )}
              {payStatus === "tooManyPending" && (
                <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-text-muted">
                  {t("topUp.tooManyPending")}
                </p>
              )}
              <button
                className="w-full rounded-lg border border-border py-2 text-sm text-text-primary"
                onClick={() => setTopUpOpen(false)}
              >
                {t("topUp.close")}
              </button>
            </>
          )}
          {tab === "history" && <TopUpHistory cloudApi={cloudApi} />}
        </div>
      </div>
    </div>
  );
}
