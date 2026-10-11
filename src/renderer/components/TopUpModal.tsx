import { useEffect, useMemo, useRef, useState } from "react";
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
import { Input } from "./ui/input";
import { Button } from "./app-button";
import { OccludingDialog } from "./ui/occluding-dialog";
import { DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

type Step = "amount" | "chain" | "pay" | "waiting";
type PayStatus =
  | "idle"
  | "confirmed"
  | "orderExpired"
  | "timeout"
  | "tooManyPending"
  | "networkError";

const QUICK_AMOUNTS = [500, 1000, 2500, 5000]; // $5 / $10 / $25 / $50（美分）

/**
 * 页签条的皮肤（原手绘 Button 的等效类：选中 = 主色填充，未选中 = 前景色文字）。
 * ui/tabs.tsx 只给结构与焦点环，选中/未选中样式由调用点用 `data-[state=*]` 表达。
 */
// 皮肤来自 ui/tabs.tsx（shadcn 默认）；这里只让两个页签平分宽度。
const TAB_TRIGGER_CLASS = "flex-1";

export function TopUpModal({
  onRestoreFocus,
  takeReturnFocusTarget,
}: {
  /**
   * 关闭时回不到原入口（入口已被移除 / 本来就是事件入口）的兜底：父级（App）
   * 把自己的 `<main>` 聚焦。只在本地返回目标失效时调用，不是关闭业务回调。
   */
  onRestoreFocus?: () => void;
  /**
   * 打开瞬间回焦目标的**注入点**：原生菜单入口（账号菜单余额行）会把被关闭菜单的
   * Trigger 交给父级暂存，这里在 Dialog 打开时优先消费它。只调用一次，且父级实现
   * 负责「读取即清空」（避免旧来源污染后续事件入口）。缺席时退回打开瞬间的 activeElement。
   */
  takeReturnFocusTarget?: () => HTMLElement | null;
} = {}) {
  const { t } = useTranslation();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /**
   * 会话代际：open / close 与 cloudApi 更换时递增，用来作废在途的 createOrder /
   * QRCode / 已确认 getMe / 轮询结果（纯 renderer 侧的响应隔离，不是后端 sessionId）。
   */
  const generationRef = useRef(0);
  /** 当前 order 属于哪一代。重开那一帧里 step/order 还是旧的 ⇒ 靠代际比对挡住旧轮询。 */
  const orderGenerationRef = useRef(-1);
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

  // 换一代：在途的 createOrder / QRCode / getMe / 轮询结果全部作废。
  // 必须声明在轮询 effect 之前（同一轮 effect 里先失效，再决定要不要起新的轮询）。
  useEffect(() => {
    generationRef.current += 1;
    orderGenerationRef.current = -1;
  }, [topUpOpen, cloudApi]);

  // 打开时重置（cloudApi 变化也要重置：生成代际已经失效，若沿用旧 order/step，
  // 轮询会被代际门挡住 ⇒ UI 冻结在旧 plan 上。token 不变时 useMemo 复用同一实例，不会重置）
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
      // 上一会话的 createOrder 可能还挂着（那时 creating 为 true）：重开/换 token 必须复位，
      // 否则 chain 步的「下一步」会永久禁用。
      setCreating(false);
    }
  }, [topUpOpen, cloudApi]);

  // 等待确认轮询：只在「弹窗真的开着 + 停在 waiting + order 属于当前代」时跑。
  // deps 含 topUpOpen ⇒ 关闭时立刻 cleanup：abort 会停止**后续** poll 并打断 sleep/backoff；
  // 已经在飞的那次 `getTopUpOrder` 不受影响（CloudApiClient 不接收 signal，无法取消底层 HTTP），
  // 它的结果 settle 后由 cancelled 门丢弃。
  useEffect(() => {
    if (!topUpOpen || step !== "waiting" || !order || !cloudApi) return;
    // 重开那一帧：step/order 还是上一会话的，reset effect 尚未落地 ⇒ 只检查 open 会误发一次旧 poll
    if (orderGenerationRef.current !== generationRef.current) return;
    const controller = new AbortController();
    let cancelled = false;
    // 与 cancelled 同门的代际快照：poll 回写 credited 时同时校验，避免旧会话金额漏进新会话
    const generation = generationRef.current;
    (async () => {
      const result = await waitForOrderConfirmation(
        (id) =>
          cloudApi.getTopUpOrder(id).then((o) => {
            const credited =
              Number.isSafeInteger(o.credited_micro_usd) &&
              o.credited_micro_usd >= 0
                ? o.credited_micro_usd
                : null;
            // 轮询被取消 / 代际已换时不能把上个订单的金额写进当前会话
            if (
              generation === generationRef.current &&
              !cancelled &&
              o.status === "confirmed"
            ) {
              setCreditedMicroUsd(credited);
            }
            return o.status;
          }),
        order.id,
        { signal: controller.signal },
      );
      if (cancelled || result === "cancelled") return;
      if (result === "confirmed") {
        try {
          const me = await cloudApi.getMe();
          // 旧会话的确认 getMe 迟到了也不能写余额/翻状态
          if (cancelled) return;
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
        if (cancelled) return;
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
      controller.abort();
    };
  }, [topUpOpen, step, order, cloudApi]);

  const parsedCents = parseAmountToCents(amountInput);
  // 以服务端创建的订单金额为准，避免展示金额与下单金额不一致
  const displayAmount = (
    (order?.amount_cents ?? amountCents ?? 0) / 100
  ).toFixed(6);

  const createOrder = async () => {
    if (!cloudApi || parsedCents === null) return;
    // 捕获当前代际：关闭/重开之后，这条请求的所有回写都要作废
    const generation = generationRef.current;
    setCreating(true);
    try {
      const created = await cloudApi.createTopUpOrder(parsedCents, chain);
      if (generation !== generationRef.current) return;
      // 这个 order 属于这一代；轮询 effect 靠它挡住重开时的旧订单
      orderGenerationRef.current = generation;
      setOrder(created);
      setStep("pay");
      try {
        const dataUrl = await QRCode.toDataURL(created.deposit_address);
        if (generation !== generationRef.current) return;
        setQrDataUrl(dataUrl);
      } catch {
        if (generation !== generationRef.current) return;
        setQrDataUrl("");
      }
    } catch (e: unknown) {
      if (generation !== generationRef.current) return;
      // fetchCore 抛出的错误带 { code, status }（Error 对象属性），网络错误无 code
      const code = (e as { code?: unknown }).code;
      setPayStatus(
        code === "TOO_MANY_PENDING" ? "tooManyPending" : "networkError",
      );
    } finally {
      // 参数不同就说明已经换会话：creating 由重开时的 reset effect 复位
      if (generation === generationRef.current) setCreating(false);
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

  const handleTabChange = (value: string) => {
    if (value === "topup" || value === "history") setTab(value);
  };

  return (
    // 外壳交给 OccludingDialog（迁移前是自建 `fixed inset-0` 遮罩，没有 occlusion）。
    // `open` 同时要求 topUpOpen 与有效 CloudApiClient：没有 cloud token 时既不渲染
    // DialogContent、也不占 occlusion（也不把 Root 卸掉，避免丢掉回焦时机）。
    <OccludingDialog
      open={topUpOpen && !!cloudApi}
      onOpenChange={(open) => {
        if (!open) setTopUpOpen(false);
      }}
    >
      {cloudApi ? (
        <Tabs
          asChild
          value={tab}
          activationMode="manual"
          onValueChange={handleTabChange}
        >
          <DialogContent
            // 原内层面板就是这一块：固定高度 + 内部滚动 + 圆角/描边/阴影。
            // vendored 的 `grid gap-4 p-6 max-w-lg` 由 cn 合并掉。
            className="flex h-[600px] max-h-[85vh] w-full max-w-md flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-lg sm:rounded-2xl [&>button]:hidden"
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              // 优先消费父级注入的原入口（账号菜单 Trigger）；没有注入（事件入口 / standalone）
              // 才退回打开瞬间的 activeElement。
              const injected = takeReturnFocusTarget?.() ?? null;
              const active = injected ?? document.activeElement;
              returnFocusRef.current =
                active instanceof HTMLElement && active !== document.body
                  ? active
                  : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = returnFocusRef.current;
              if (target?.isConnected && !target.matches(":disabled")) {
                target.focus({ preventScroll: true });
                // 连接且非 disabled 仍可能不可聚焦，落焦不成功才用父级 fallback
                if (document.activeElement !== target) onRestoreFocus?.();
              } else onRestoreFocus?.();
            }}
          >
            <DialogHeader className="flex flex-col gap-4 space-y-0 px-6 pt-6 text-left">
              <DialogTitle className="text-lg font-semibold text-foreground">
                {t("topUp.title")}
              </DialogTitle>
              <TabsList className="w-full">
                <TabsTrigger value="topup" className={TAB_TRIGGER_CLASS}>
                  {t("topUp.topupTab")}
                </TabsTrigger>
                <TabsTrigger value="history" className={TAB_TRIGGER_CLASS}>
                  {t("topUp.historyTab")}
                </TabsTrigger>
              </TabsList>
            </DialogHeader>
            {/* 滚动区从旧的共享外层 div 下放到每个面板：两个页签都是 flex 直接子元素，
              min-h-0 才能让 overflow-y-auto 真的滚而不是把面板撑高。 */}
            {/* 面板内容仍按原值条件渲染：Radix 把非当前值面板留在 DOM 里（hidden 空壳），
                不补这层守卫的话历史列表会在充值页一打开就挂载并拉订单 —— 迁移前是切到才挂载。
                面板壳保留，只为 a11y（role=tabpanel + aria 关联）。 */}
            <TabsContent
              value="topup"
              className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6"
            >
              {tab === "topup" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("topUp.subtitle")}
                  </p>

                  {step === "amount" && (
                    <>
                      <label className="text-sm text-foreground">
                        {t("topUp.amountLabel")}
                      </label>
                      <Input
                        className="h-auto w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none outline-none focus:border-primary"
                        placeholder={t("topUp.amountPlaceholder")}
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        inputMode="decimal"
                      />
                      {amountInput !== "" && parsedCents === null && (
                        <p className="text-sm text-destructive">
                          {t("topUp.invalidAmount")}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {QUICK_AMOUNTS.map((cents) => (
                          <Button
                            variant="ghost"
                            key={cents}
                            className="h-auto rounded-full border border-border px-3 py-1 text-sm text-foreground hover:border-primary hover:bg-transparent hover:text-foreground"
                            onClick={() =>
                              setAmountInput((cents / 100).toFixed(2))
                            }
                          >
                            ${cents / 100}
                          </Button>
                        ))}
                      </div>
                      <Button
                        variant="default"
                        className="h-auto w-full rounded-lg py-2 text-sm disabled:opacity-40"
                        disabled={parsedCents === null}
                        onClick={() =>
                          parsedCents !== null &&
                          (setAmountCents(parsedCents), setStep("chain"))
                        }
                      >
                        {t("topUp.next")}
                      </Button>
                    </>
                  )}

                  {step === "chain" && (
                    <>
                      <label className="text-sm text-foreground">
                        {t("topUp.chainLabel")}
                      </label>
                      <div className="flex flex-col gap-2">
                        {(["bsc", "arb", "base"] as const).map((c) => (
                          <Button
                            variant="ghost"
                            key={c}
                            className={`h-auto rounded-lg border px-3 py-2 text-sm text-foreground hover:bg-transparent hover:text-foreground ${
                              chain === c ? "border-primary" : "border-border"
                            }`}
                            onClick={() => setChain(c)}
                          >
                            {c === "bsc"
                              ? t("topUp.chainBsc")
                              : c === "arb"
                                ? t("topUp.chainArb")
                                : t("topUp.chainBase")}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("topUp.chainHint")}
                      </p>
                      {payStatus === "networkError" && (
                        <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                          {t("topUp.networkError")}
                        </p>
                      )}
                      {payStatus === "tooManyPending" && (
                        <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                          {t("topUp.tooManyPending")}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          className="h-auto flex-1 rounded-lg border border-border py-2 text-sm text-foreground hover:bg-transparent hover:text-foreground"
                          onClick={() => setStep("amount")}
                        >
                          {t("topUp.back")}
                        </Button>
                        <Button
                          variant="default"
                          className="h-auto flex-1 rounded-lg py-2 text-sm"
                          disabled={creating}
                          onClick={createOrder}
                        >
                          {t("topUp.next")}
                        </Button>
                      </div>
                    </>
                  )}

                  {step === "pay" && order && (
                    <>
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-4">
                        {qrDataUrl ? (
                          <img src={qrDataUrl} alt="QR" className="h-40 w-40" />
                        ) : (
                          <div className="h-40 w-40 rounded-lg bg-background/60" />
                        )}
                        <p className="text-xs text-muted-foreground">
                          {t("topUp.qrHint")}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-muted-foreground">
                          {t("topUp.addressLabel")}
                        </span>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 break-all rounded-lg border border-border px-2 py-1.5 text-xs text-foreground">
                            {order.deposit_address}
                          </code>
                          <Button
                            variant="ghost"
                            className="h-auto rounded-lg border border-border px-2 py-1.5 text-xs text-foreground hover:bg-transparent hover:text-foreground"
                            onClick={copyAddress}
                          >
                            {copied ? t("topUp.copied") : t("topUp.copy")}
                          </Button>
                        </div>
                        <span className="mt-2 text-sm text-muted-foreground">
                          {t("topUp.amountToSend")}
                        </span>
                        <span className="text-base font-semibold text-foreground">
                          {displayAmount}{" "}
                          {chain === "base" ? "USDC" : "USDT/USDC"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("topUp.payHint", { amount: displayAmount })}
                      </p>
                      {/* 「我已完成支付」= pay 步的主操作（Task11 收敛）。 */}
                      <Button
                        variant="default"
                        className="h-auto w-full rounded-lg py-2 text-sm"
                        onClick={startWaiting}
                      >
                        {t("topUp.next")}
                      </Button>
                    </>
                  )}

                  {step === "waiting" && (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        {t("topUp.waitingTitle")}
                      </p>
                      <p className="text-sm text-muted-foreground">
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
                        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          {t("topUp.orderExpired")}
                        </p>
                      )}
                      {payStatus === "timeout" && (
                        <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                          {t("topUp.timeout")}
                        </p>
                      )}
                      {payStatus === "tooManyPending" && (
                        <p className="rounded-lg bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                          {t("topUp.tooManyPending")}
                        </p>
                      )}
                      <Button
                        variant="ghost"
                        className="h-auto w-full rounded-lg border border-border py-2 text-sm text-foreground hover:bg-transparent hover:text-foreground"
                        onClick={() => setTopUpOpen(false)}
                      >
                        {t("topUp.close")}
                      </Button>
                    </>
                  )}
                </>
              )}
            </TabsContent>
            <TabsContent
              value="history"
              className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6"
            >
              {tab === "history" && <TopUpHistory cloudApi={cloudApi} />}
            </TabsContent>
          </DialogContent>
        </Tabs>
      ) : null}
    </OccludingDialog>
  );
}
