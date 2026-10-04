import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActionResult, ConnectorEntry } from "../../../shared/connectors";
import {
  CATEGORY_ORDER,
  type CatalogCategory,
} from "../../../shared/mcp-catalog";
import { AddServerDialog } from "./AddServerDialog";
import { MailAccountDialog } from "./MailAccountDialog";
import { ConnectorCard } from "./ConnectorCard";
import { KeyDialog } from "./KeyDialog";
import { SettingsSkills } from "../settings/SettingsSkills";
import { PiExtensionManagerView } from "../PiExtensionManagerView";
import { ArrowLeft } from "lucide-react";
import { useAppStore } from "../../store";

type TabId = "connect" | "skills" | "plugins";

/** 分段与 chip 的分组 id：目录的 5 个分类 + 邮箱 + 视图层的 `other`（用户自建）。
 *  放在模块级 —— 类型与顺序都是常量，放进组件体会每次渲染重建。 */
type GroupId = CatalogCategory | "mail" | "other";
/** `mail` 在最前：邮箱是**你自己的账号**，目录段是「可以加的服务」——发现与拥有不是一回事。 */
const GROUP_ORDER: readonly GroupId[] = ["mail", ...CATEGORY_ORDER, "other"];
/** 邮箱条目没有 `category`，若只按 `entry.category ?? "other"` 分组，
 *  张三的 QQ 邮箱会和用户手搓的 `my-tools` 一起躺进「自建服务」段 —— 页面不报错，
 *  只是位置错了。所以这里按 `source` 再分流一次。 */
const groupKeyOf = (entry: ConnectorEntry): GroupId =>
  entry.category ?? (entry.source === "mail" ? "mail" : "other");

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
  /** 回调里要读**最新**列表，但 `connectEntries` 是每渲染新建的数组，
   *  放进 `useCallback` 依赖会让回调身份每渲染都变。用 ref 取。 */
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [addOpen, setAddOpen] = useState(false);
  /** 「添加」下面的两项菜单（MCP / 邮箱）。false = 菜单收起。 */
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  /** 正在填凭据的 key 型条目。null = 对话框关闭。 */
  const [keyEntry, setKeyEntry] = useState<ConnectorEntry | null>(null);
  /** 等用户在确认框里点头的待删除邮箱（邮箱地址）。null = 没有确认框。 */
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
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

  // 菜单收起要能用 Esc —— 它盖在列表上，没有键盘出口时只能靠再点一次「添加」。
  useEffect(() => {
    if (!addMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addMenuOpen]);

  // 连接页只装**外部服务**（目录条目 + 用户自建）。应用自带的能力（Computer Use）
  // 住在设置的「能力」里 —— 它的数据仍由 registry.list() 产出，只是不在这里渲染。
  // 若将来有第三个页面读这份列表，那就该把能力拆成独立的 IPC（见设计文档 §3.1）。
  const connectEntries = entries.filter(
    (entry) => entry.source !== "mcp-builtin",
  );
  // 顺序 = registry.list() 的返回序（目录 → 应用自带 → 用户自建），
  // 但展示时按分类分段：段序由 CATEGORY_ORDER 决定，`other`（用户自建）永远在最后。
  const [category, setCategory] = useState<GroupId | "all">("all");
  /** 「已接入」筛选：只看有实例的条目（服务在 mcp.json 里）。
   *  不看 status —— ready 会随会话在 ready/idle 之间跳、off 只表示停用，
   *  拿状态当判定会让计数自己变、也会把停用的服务从列表里弄丢（见设计文档 F3）。 */
  const [addedOnly, setAddedOnly] = useState(false);
  const added = connectEntries.filter((e) => e.instances.length > 0);
  const shown = addedOnly ? added : connectEntries;
  /** 空分组不参与渲染 —— 没有内容的分段标题是噪音，chip 同理（见下）。 */
  const groups = GROUP_ORDER.map((id) => ({
    id,
    entries: shown.filter((e) => groupKeyOf(e) === id),
  })).filter((g) => g.entries.length > 0);
  /** 选中的分类若因条目消失而归零（用户删掉了最后一条自建 server），回落「全部」——
   *  这样列表里不存在「筛选后空空荡荡」的状态。 */
  const selectedGroupGone =
    category !== "all" && !groups.some((g) => g.id === category);
  // 只改显示是不够的：状态还记着那个分类，用户下次再加回同类条目时会静默套上旧筛选。
  useEffect(() => {
    if (selectedGroupGone) setCategory("all");
  }, [selectedGroupGone]);
  const activeCategory: GroupId | "all" = selectedGroupGone ? "all" : category;
  const visibleGroups =
    activeCategory === "all"
      ? groups
      : groups.filter((g) => g.id === activeCategory);

  const onConnect = useCallback(
    async (key: string) => {
      // key 型条目**不走授权**：没有浏览器要开，让用户先粘凭据。
      // 入口分在这里而不是卡片里 —— 卡片只转发 serverName，再让它认识凭据形态
      // 就会把「怎么连」变成两处各自实现的规则。
      // 用 ref 读列表，不用 `connectEntries`：它是每渲染新建的数组，
      // 放进依赖数组会让这个回调的身份每渲染都变。
      const target = entriesRef.current.find((e) => e.serverName === key);
      if (target?.auth?.kind === "key") {
        setKeyEntry(target);
        return;
      }
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

  /** key 型条目写盘成功后的收尾：刷新列表 + 把「下次对话生效」如实说出来（没会话时）。 */
  const onKeyConnected = useCallback(
    (res: ActionResult) => {
      setError("");
      reportIfPending(res);
      void refresh();
    },
    [refresh, reportIfPending],
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
        if (!res.ok) setError(res.error ?? t("connectors.removeFailed"));
      } catch {
        setError(t("connectors.removeFailed"));
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

  /**
   * 邮箱的「删除」只开确认框，**不在这里发 IPC**。
   * 目录条目删了能一键加回，邮箱不行 —— 重新添加要去服务商网站再捞一个
   * 16 位授权码。所以删除必须先过用户那关。
   */
  const onRemoveMailbox = useCallback((email: string) => {
    setError("");
    setNotice("");
    setPendingRemove(email);
  }, []);

  /** 确认后才会走到这里 —— 删的是账号，不是 `Mail` 这台 server。 */
  const confirmRemoveMailbox = useCallback(
    async (email: string) => {
      setPendingRemove(null);
      setError("");
      setNotice("");
      try {
        const res = await window.electronAPI.mail.removeAccount(email);
        if (!res.ok) setError(res.error ?? t("connectors.removeFailed"));
      } catch {
        setError(t("connectors.removeFailed"));
      } finally {
        await refresh();
      }
    },
    [refresh, t],
  );

  /** 测试写回 `lastCheck`，所以跑完刷新列表 —— 卡片状态行就是它的结果。 */
  const onTestMailbox = useCallback(
    async (email: string) => {
      setError("");
      setNotice("");
      try {
        const res = await window.electronAPI.mail.testAccount(email);
        if (!res.ok) setError(res.error ?? t("connectors.mail.testFailed"));
      } catch {
        setError(t("connectors.mail.testFailed"));
      } finally {
        await refresh();
      }
    },
    [refresh, t],
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
      </div>

      {/* 外层相对定位：报错/提示用**浮层**呈现 —— 既不会留一片永久空白
          （固定槽位试过，用户否掉了），也不会在出现时把整个列表推下去。 */}
      <div className="flex-1 relative min-h-0">
        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={`absolute top-3 left-5 right-5 z-20 px-4 py-2.5 rounded-lg shadow-elevated text-sm ${
              error
                ? "bg-error/10 text-error"
                : "bg-surface-hover text-text-secondary"
            }`}
          >
            {error || notice}
          </div>
        )}
        <div className="h-full overflow-y-auto p-5">
          {tab === "connect" && (
            <>
              {/* 吸顶工具栏：左 = 分类 chip 条（可点 = 过滤），右 = 添加。
                吸顶让「添加」永远可见，不随列表滚出视野。 */}
              <div
                data-testid="catalog-toolbar"
                className="sticky top-0 z-10 -mx-1 px-1 pb-3 bg-background flex items-center gap-1.5 flex-wrap"
              >
                <CategoryChip
                  id="all"
                  label={t("connectors.category.all")}
                  count={shown.length}
                  active={activeCategory}
                  onSelect={setCategory}
                />
                {groups.map((g) => (
                  <CategoryChip
                    key={g.id}
                    id={g.id}
                    label={t(`connectors.category.${g.id}`)}
                    count={g.entries.length}
                    active={activeCategory}
                    onSelect={setCategory}
                  />
                ))}
                <span className="flex-1" />
                <button
                  type="button"
                  data-testid="added-filter"
                  aria-pressed={addedOnly}
                  onClick={() => setAddedOnly((v) => !v)}
                  className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap transition-colors ${
                    addedOnly
                      ? "bg-accent-muted text-accent border-transparent"
                      : "border-border-muted text-text-secondary hover:bg-surface-hover"
                  }`}
                >
                  {t("connectors.filter.added")}
                  <span className="text-[11px] opacity-75 ml-1">
                    {added.length}
                  </span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                    onClick={() => setAddMenuOpen((v) => !v)}
                    className="px-3 py-1 rounded-control bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors"
                  >
                    {t("connectors.action.add")}
                  </button>
                  {/* 菜单**绝对定位**在按钮下方：工具栏是 flex-wrap，
                      参与布局的菜单会把 chip 挤到下一行（工具栏自己会跳一下）。 */}
                  {addMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1 z-20 w-[210px] bg-surface border border-border rounded-xl shadow-elevated overflow-hidden"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="add-mcp"
                        onClick={() => {
                          setAddMenuOpen(false);
                          setAddOpen(true);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-surface-hover transition-colors"
                      >
                        <span className="block text-sm font-semibold text-text-primary">
                          {t("connectors.addMenu.server")}
                        </span>
                        <span className="block text-xs text-text-muted">
                          {t("connectors.addMenu.serverHint")}
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="add-mail"
                        onClick={() => {
                          setAddMenuOpen(false);
                          setMailOpen(true);
                        }}
                        className="w-full text-left px-3 py-2.5 border-t border-border-muted hover:bg-surface-hover transition-colors"
                      >
                        <span className="block text-sm font-semibold text-text-primary">
                          {t("connectors.addMenu.mailbox")}
                        </span>
                        <span className="block text-xs text-text-muted">
                          {t("connectors.addMenu.mailboxHint")}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 筛选开着且一条都没有：必须给出口 —— 此时既没有卡片可点，
                  也没有任何「连接」按钮可达，没有出口就是死路（见设计文档 F6）。 */}
              {addedOnly && added.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-12">
                  {/* role="status"：屏幕阅读器要听到列表已空 —— 否则开关的 aria-pressed
                      变了、内容却静默换了。 */}
                  <p role="status" className="text-sm text-text-secondary">
                    {t("connectors.filter.empty")}
                  </p>
                  <button
                    type="button"
                    data-testid="added-filter-show-all"
                    onClick={() => setAddedOnly(false)}
                    className="text-xs px-3 py-1 rounded-full border border-border-muted text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    {t("connectors.filter.showAll")}
                  </button>
                </div>
              )}

              {visibleGroups.map((g) => (
                <section key={g.id} className="mb-5 last:mb-0">
                  <h3
                    data-testid="section-title"
                    className="text-sm font-semibold text-text-secondary mb-2 flex items-baseline gap-2"
                  >
                    {t(`connectors.category.${g.id}`)}
                    <span className="text-[11px] font-normal text-text-muted">
                      {g.entries.length}
                    </span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {g.entries.map((entry) => (
                      <ConnectorCard
                        key={entry.key}
                        entry={entry}
                        authorizing={authPending[entry.serverName] === true}
                        onConnect={onConnect}
                        onDisconnect={onDisconnect}
                        onAuthorize={onAuthorize}
                        onCancel={onCancel}
                        onToggle={onToggle}
                        onTestMailbox={onTestMailbox}
                        onRemoveMailbox={onRemoveMailbox}
                      />
                    ))}
                  </div>
                </section>
              ))}
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
      <MailAccountDialog
        isOpen={mailOpen}
        onClose={() => setMailOpen(false)}
        onAdded={() => void refresh()}
      />
      <KeyDialog
        entry={keyEntry}
        onClose={() => setKeyEntry(null)}
        onConnected={onKeyConnected}
      />

      {/* 删除邮箱的确认框。内联渲染在这里（而不是卡片里）——
          一个页面同时只会有一个待删邮箱，状态放视图层就不会有多份。 */}
      {pendingRemove && (
        <div
          data-testid="mail-remove-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in"
        >
          <div className="card w-full max-w-sm p-5 m-4 shadow-elevated animate-slide-up">
            <p className="text-sm font-medium text-text-primary">
              {t("connectors.mail.removeConfirmTitle")}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {t("connectors.mail.removeConfirmBody", { email: pendingRemove })}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setPendingRemove(null)}
                className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoveMailbox(pendingRemove)}
                className="px-3 py-1.5 rounded-lg bg-error/10 text-error hover:bg-error/20 text-sm font-medium transition-colors"
              >
                {t("connectors.action.removeMailbox")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 吸顶工具栏里的分类 chip。计数为 0 的分类不会走到这里 —— 调用方已经过滤掉了。 */
function CategoryChip({
  id,
  label,
  count,
  active,
  onSelect,
}: {
  id: GroupId | "all";
  label: string;
  count: number;
  active: GroupId | "all";
  onSelect: (id: GroupId | "all") => void;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      data-testid="category-chip"
      data-category={id}
      aria-pressed={isActive}
      onClick={() => onSelect(id)}
      className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap transition-colors ${
        isActive
          ? "bg-accent-muted text-accent border-transparent"
          : "border-border-muted text-text-secondary hover:bg-surface-hover"
      }`}
    >
      {label}
      <span className="text-[11px] opacity-75 ml-1">{count}</span>
    </button>
  );
}
