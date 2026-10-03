import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActionResult, ConnectorEntry } from "../../../shared/connectors";
import { AddServerDialog } from "./AddServerDialog";
import { ConnectorCard } from "./ConnectorCard";
import { SettingsSkills } from "../settings/SettingsSkills";
import { PiExtensionManagerView } from "../PiExtensionManagerView";
import { ArrowLeft } from "lucide-react";
import { useAppStore } from "../../store";

type TabId = "connect" | "skills" | "plugins";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

/** 用户主动取消不是失败：主进程用 cancelled 标记，界面不该报红。 */
function isCancelled(res: ActionResult): boolean {
  return res.cancelled === true;
}

export function ConnectorsView() {
  const { t } = useTranslation();
  const setActiveView = useAppStore((s) => s.setActiveView);
  const [tab, setTab] = useState<TabId>("connect");
  const [entries, setEntries] = useState<ConnectorEntry[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /**
   * 本地的「正在等这次授权」，按 server name 记。
   * 与传输层的 `connecting` 无关：从点下「连接/重新授权」到 IPC 返回之间，
   * 传输层可能什么都还没发生，但用户必须看得到进度、也必须能中止。
   */
  const [authPending, setAuthPending] = useState<Record<string, boolean>>({});
  /** 同步守卫：同一个事件里连点两次时 state 还没落地，只有 ref 拦得住。 */
  const authPendingRef = useRef(new Set<string>());
  /** 每个 server 一个操作序号：断开会让在途操作作废，其回调不再报错/提示。 */
  const actionSeqRef = useRef(new Map<string, number>());

  const beginAuth = useCallback((serverName: string): number | undefined => {
    if (authPendingRef.current.has(serverName)) return undefined;
    authPendingRef.current.add(serverName);
    setAuthPending((prev) => ({ ...prev, [serverName]: true }));
    const seq = (actionSeqRef.current.get(serverName) ?? 0) + 1;
    actionSeqRef.current.set(serverName, seq);
    return seq;
  }, []);

  const endAuth = useCallback((serverName: string): void => {
    authPendingRef.current.delete(serverName);
    setAuthPending((prev) => {
      if (!(serverName in prev)) return prev;
      const next = { ...prev };
      delete next[serverName];
      return next;
    });
  }, []);

  const isStale = useCallback(
    (serverName: string, seq: number): boolean =>
      actionSeqRef.current.get(serverName) !== seq,
    [],
  );

  const invalidate = useCallback((serverName: string): void => {
    actionSeqRef.current.set(
      serverName,
      (actionSeqRef.current.get(serverName) ?? 0) + 1,
    );
  }, []);

  /** 把「写盘成功但没会话，下次对话才生效」如实说出来 —— 否则界面毫无变化。 */
  /**
   * 操作结束后刷新提示：只有「写盘成功但没会话、下次对话才生效」才留提示。
   * 其它情况清掉 —— 否则「已在浏览器打开授权页」会一直挂着，
   * 哪怕授权早就完成或早已失败。
   */
  const reportIfPending = useCallback(
    (res: { ok: boolean; pendingActivation?: boolean }) => {
      setNotice(
        res.ok && res.pendingActivation ? t("connectors.activatePending") : "",
      );
    },
    [t],
  );

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    try {
      setEntries(await window.electronAPI.connectors.list());
      // 刻意不在这里 setError("")：刷新成功只说明列表读到了，
      // 不说明上一次操作成功。顺手清错误会让操作失败的红字一闪而过。
    } catch {
      setError(t("connectors.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (!isElectron) return;
    void refresh();
    // 状态变更由主进程推送，取代轮询
    return window.electronAPI.connectors.onStatusChanged(() => {
      void refresh();
    });
  }, [refresh]);

  // 只有一个 MCP 列表 —— 条目不再带 tab（动作由 entry.transport 判定）
  const connectEntries = entries;

  // 平铺 + 固定顺序（D12）：不按状态分组、已添加的不上浮。
  // 顺序 = registry.list() 的返回序（目录 → 应用自带 → 用户自建）。
  // 本轮去掉了筛选行（只剩「全部」不构成筛选），所以直接用全量。
  const shown = connectEntries;

  const onConnect = useCallback(
    async (key: string) => {
      // 已经在等授权就别再发一次：在途的流程还没结束，重复发起只会多一个回调服务器。
      const seq = beginAuth(key);
      if (seq === undefined) return;
      setError("");
      // 连接会顺带发起授权（并可能打开浏览器）。整个过程要等用户在浏览器里
      // 点完「批准」，可能几十秒 —— 先说出来，别让人以为卡住了。
      setNotice(t("connectors.signInStarted"));
      try {
        const res = await window.electronAPI.connectors.addCatalogServer(key);
        // 断开已经作废了这次操作：它的结果不该再影响界面。
        if (isStale(key, seq)) return;
        if (!res.ok && !isCancelled(res)) {
          setError(res.error ?? t("connectors.connectFailed"));
        }
        reportIfPending(res);
      } catch {
        if (!isStale(key, seq)) setError(t("connectors.connectFailed"));
      } finally {
        // 只有原流程真正 settle 之后才允许再次授权。
        endAuth(key);
        await refresh();
      }
    },
    [beginAuth, endAuth, isStale, refresh, t, reportIfPending],
  );

  const onDisconnect = useCallback(
    async (id: string) => {
      setError("");
      setNotice("");
      if (authPendingRef.current.has(id)) {
        // 先中止授权再删：等回调回来再写凭据，会把刚删掉的 server 又接上。
        // 同时作废在途操作，免得它收尾时再弹一次失败/提示。
        invalidate(id);
        void window.electronAPI.connectors.cancelSignIn(id).catch(() => {});
      }
      try {
        const res = await window.electronAPI.connectors.removeServer(id);
        if (!res.ok) setError(res.error ?? t("connectors.disconnectFailed"));
      } catch {
        setError(t("connectors.disconnectFailed"));
      } finally {
        // 原授权的 finally 负责清 pending，删除成功不代表它已经结束。
        await refresh();
      }
    },
    [invalidate, refresh, t],
  );

  const onAuthorize = useCallback(
    async (id: string) => {
      const seq = beginAuth(id);
      if (seq === undefined) return;
      setError("");
      setNotice("");
      try {
        const res = await window.electronAPI.connectors.authorize(id);
        if (isStale(id, seq)) return;
        if (!res.ok && !isCancelled(res)) {
          setError(res.error ?? t("connectors.connectFailed"));
        }
        reportIfPending(res);
      } catch {
        if (!isStale(id, seq)) setError(t("connectors.connectFailed"));
      } finally {
        endAuth(id);
        await refresh();
      }
    },
    [beginAuth, endAuth, isStale, refresh, t, reportIfPending],
  );

  const onCancel = useCallback(
    async (id: string) => {
      setError("");
      setNotice("");
      try {
        const res = await window.electronAPI.connectors.cancelSignIn(id);
        // 没有在等授权时不算错 —— 用户只是想中止，结果本来就可能是「已经结束了」。
        // 主动取消（cancelled）同理：那是预期结果，不是失败。
        if (
          !res.ok &&
          !isCancelled(res) &&
          res.error !== "no sign-in in progress"
        ) {
          setError(res.error ?? t("connectors.connectFailed"));
        }
      } catch {
        setError(t("connectors.connectFailed"));
      }
      // 刻意不在这里收尾：等原流程 settle 后由它的 finally 清 pending，
      // 否则旧流程还挂着就能重新点授权。
    },
    [t],
  );

  const onToggle = useCallback(
    async (id: string, enabled: boolean) => {
      setError("");
      setNotice("");
      const res = await window.electronAPI.connectors.setEnabled(id, enabled);
      if (!res.ok) setError(res.error ?? t("connectors.connectFailed"));
      reportIfPending(res);
      await refresh();
    },
    [refresh, t, reportIfPending],
  );

  const tabs: Array<[TabId, string]> = [
    ["connect", t("connectors.tab.connect")],
    ["skills", t("connectors.tab.skills")],
    ["plugins", t("connectors.tab.plugins")],
  ];

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      <div className="flex items-center gap-3 px-5 pt-4 flex-none">
        <button
          type="button"
          onClick={() => setActiveView("chat")}
          aria-label={t("common.back")}
          className="-ml-1.5 rounded-lg p-1.5 transition-colors hover:bg-surface-hover"
        >
          <ArrowLeft className="h-5 w-5 text-text-secondary" />
        </button>
        <h2 className="text-xl font-semibold text-text-primary">
          {t("connectors.title")}
        </h2>
        <span className="text-xs text-text-muted">
          {t("connectors.subtitle")}
        </span>
      </div>

      <div className="flex items-center gap-0.5 px-5 pt-3 border-b border-border-muted flex-none">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors ${
              tab === id
                ? "border-accent text-text-primary font-semibold"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
        {/* 「添加」只对 MCP 有意义，所以只在这一 tab 出现 —— 放在标签栏里，
            它不再独占一行（原先列表上方多出一整行空白） */}
        {tab === "connect" && (
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mb-1 px-3 py-1 rounded-control bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors"
            >
              {t("connectors.action.add")}
            </button>
          </>
        )}
      </div>

      {/* 外层相对定位：报错/提示用**浮层**呈现 —— 既不会留一片永久空白
          （固定槽位试过，用户否掉了），也不会在出现时把整个列表推下去。 */}
      <div className="flex-1 relative min-h-0">
        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={`absolute top-3 left-5 right-5 z-10 px-4 py-2.5 rounded-lg shadow-elevated text-sm ${
              error ? "bg-error/10 text-error" : "bg-surface-hover text-text-secondary"
            }`}
          >
            {error || notice}
          </div>
        )}
        <div className="h-full overflow-y-auto p-5">
        {tab === "connect" && (
          <>

            {shown.length === 0 ? (
              <div className="py-10 text-center text-sm text-text-muted border border-dashed border-border-muted rounded-container">
                {t("connectors.allHealthy")}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {shown.map((entry) => (
                  <ConnectorCard
                    key={entry.key}
                    entry={entry}
                    authorizing={authPending[entry.serverName] === true}
                    onConnect={onConnect}
                    onDisconnect={onDisconnect}
                    onAuthorize={onAuthorize}
                    onCancel={onCancel}
                    onToggle={onToggle}
                  />
                ))}
                <MoreComingCard />
              </div>
            )}
          </>
        )}

          {tab === "skills" && <SettingsSkills isActive={true} />}
          {tab === "plugins" && <PiExtensionManagerView />}
        </div>
      </div>

      <AddServerDialog
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => void refresh()}
      />
    </div>
  );
}

/** 网格末尾的占位卡：首期 5 个不至于看起来像「就这么点」。 */
function MoreComingCard() {
  const { t } = useTranslation();
  return (
    <div className="rounded-container border border-dashed border-border-muted grid place-items-center min-h-[96px]">
      <div className="text-center text-xs text-text-muted leading-relaxed">
        {t("connectors.moreComing")}
        <br />
        <span className="text-[11px]">{t("connectors.moreComingHint")}</span>
      </div>
    </div>
  );
}
