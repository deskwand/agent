import { useTranslation } from "react-i18next";
import type {
  ConnectorEntry,
  ConnectorInstance,
} from "../../../shared/connectors";

interface Props {
  entry: ConnectorEntry;
  /** "grid" 是发现视图（卡片），"row" 是管理视图（紧凑行）。见设计文档 D12。 */
  variant?: "grid" | "row";
  /**
   * 本地正在等这次授权（IPC 还没返回）。它优先于传输状态：
   * 传输层此时可能什么都还没发生，但用户刚点了「连接/重新授权」，
   * 看到的必须是「授权中 + 取消」，而不是一个还能再点的「连接」。
   */
  authorizing?: boolean;
  /** 传 entry.serverName —— registry 按目录 key 查表，不认卡片的复合 key */
  onConnect: (serverName: string) => void;
  onDisconnect: (instanceId: string) => void;
  onAuthorize: (instanceId: string) => void;
  /** 中止正在进行的授权 —— 否则用户只能干等回调超时。 */
  onCancel: (instanceId: string) => void;
  onToggle: (instanceId: string, enabled: boolean) => void;
}

function dotClass(kind: ConnectorInstance["status"]["kind"]): string {
  switch (kind) {
    case "ready":
      return "bg-success";
    case "idle":
      return "bg-text-muted";
    case "authorized":
      return "bg-success/60";
    case "connecting":
      return "bg-accent animate-pulse";
    case "needs-auth":
      return "bg-warning";
    case "failed":
      return "bg-error";
    case "off":
      return "bg-text-muted";
  }
}

function statusText(
  status: ConnectorInstance["status"],
  t: (key: string) => string,
): string {
  switch (status.kind) {
    case "ready":
      return t("connectors.status.ready");
    case "idle":
      return t("connectors.status.idle");
    case "authorized":
      // 说清接下来会发生什么 —— 这个状态没有可点的动作。
      return `${t("connectors.status.authorized")} · ${t("connectors.status.authorizedHint")}`;
    case "connecting":
      return t("connectors.status.connecting");
    case "needs-auth":
      return t("connectors.status.needsAuth");
    case "failed":
      return `${t("connectors.status.failed")} · ${status.message}`;
    case "off":
      return t("connectors.status.off");
  }
}

export function ConnectorCard({
  entry,
  variant = "grid",
  authorizing = false,
  onConnect,
  onDisconnect,
  onAuthorize,
  onCancel,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const instance = entry.instances[0];
  const isCapability = entry.tab === "capability";
  const isRow = variant === "row";
  /** 没有实例 = 还没添加过，视为关闭；开关照样可点。 */
  const capabilityOn = !!instance && instance.status.kind !== "off";
  const name = t(entry.nameKey);

  /** 传输层状态文案；能力开关卡片也用它（开关卡片没有 OAuth 流程，不看 authorizing）。 */
  const instanceStatus = instance
    ? statusText(instance.status, t)
    : t("connectors.status.off");
  /** 本地待授权优先于传输状态。 */
  const statusLabel = authorizing
    ? t("connectors.status.connecting")
    : instanceStatus;
  const dotKind = authorizing ? "connecting" : instance?.status.kind;

  const statusLine = isCapability ? (
    <span className="text-xs text-text-secondary">{instanceStatus}</span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs text-text-secondary min-w-0">
      {dotKind && (
        <span
          className={`w-1.5 h-1.5 rounded-full flex-none ${dotClass(dotKind)}`}
        />
      )}
      <span className="truncate">{statusLabel}</span>
    </span>
  );

  const actions = isCapability ? (
    <button
      type="button"
      role="switch"
      aria-checked={capabilityOn}
      aria-label={t(entry.nameKey)}
      // 未添加的预设也要能打开：registry 会先把它写进 mcp.json 再启用。
      // 之前这里是 `disabled={!instance}` + `instance && onToggle(...)`，
      // 于是开关永远是灰的 —— 后端支持、前端把门堵上了。
      onClick={() => onToggle(entry.serverName, !capabilityOn)}
      className={`w-[34px] h-5 rounded-full relative transition-colors flex-none ${
        capabilityOn ? "bg-accent" : "bg-surface-active"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
          capabilityOn ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  ) : (
    renderAction(entry, instance, authorizing, t, {
      onConnect,
      onDisconnect,
      onAuthorize,
      onCancel,
    })
  );

  /**
   * 动作组包一层，多个按钮从此不可拆。
   * grid 卡里它进标题行右侧，与状态文字不在同一个容器 —— 否则任何
   * 「两端对齐」的容器都会把按钮甩到卡片正中（见设计文档 P3）。
   * row 形态不加包裹，DOM 与改版前逐字一致。
   */
  const actionGroup = isRow ? (
    actions
  ) : (
    <div className="flex items-center gap-2 flex-none">{actions}</div>
  );

  // row：管理视图（「已添加」筛选 / 本机能力 tab）。结构刻意与改版前逐字一致 ——
  // src/tests/connectors/connectors-e2e.test.ts 按源码文本断言 t(instance.summary)。
  if (isRow) {
    return (
      <div className="bg-surface border border-border-muted rounded-lg px-3.5 py-3 flex items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-7 h-7 text-xs rounded-lg bg-accent-muted text-accent grid place-items-center font-bold flex-none">
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-primary">
              {name}
            </div>
            {instance && (
              <div className="text-xs text-text-muted mt-0.5 truncate">
                {t(instance.summary)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-none">
          {!isCapability && statusLine}
          {actionGroup}
        </div>
      </div>
    );
  }

  // grid：发现视图。名称与动作同一行，说明与状态在内容列里各占一行。
  return (
    <div className="bg-surface border border-border-muted rounded-container p-3.5 flex gap-2.5 shadow-card hover:bg-surface-hover">
      <div className="w-8 h-8 text-sm rounded-lg bg-accent-muted text-accent grid place-items-center font-bold flex-none">
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate">
            {name}
          </div>
          {actionGroup}
        </div>
        {entry.descriptionKey && (
          <div className="text-xs text-text-muted line-clamp-2">
            {t(entry.descriptionKey)}
          </div>
        )}
        {statusLine}
      </div>
    </div>
  );
}

function renderAction(
  entry: ConnectorEntry,
  instance: ConnectorInstance | undefined,
  authorizing: boolean,
  t: (key: string) => string,
  handlers: {
    onConnect: (serverName: string) => void;
    onDisconnect: (id: string) => void;
    onAuthorize: (id: string) => void;
    onCancel: (id: string) => void;
  },
) {
  const primary =
    "px-2.5 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-hover transition-colors";
  const ghost =
    "px-2.5 py-1 text-xs rounded-control border border-border text-text-primary hover:bg-surface-hover transition-colors";

  // 规则：只要已添加，就永远给一条退路（「断开」）。
  // 之前 `connecting` 只给一个禁用按钮 —— 用户不能取消、不能重试、不能断开，
  // 只能手动去改 mcp.json。任何状态都不该把人困住。
  const disconnectButton = instance ? (
    <button
      type="button"
      className={ghost}
      onClick={() => handlers.onDisconnect(instance.id)}
    >
      {t("connectors.action.disconnect")}
    </button>
  ) : null;

  // 本地授权待处理优先于传输状态。未添加的条目此刻还没有实例，
  // 取消只能用 serverName —— registry 按 mcp.json 里的 server 名查授权表。
  if (authorizing) {
    return (
      <>
        <button
          type="button"
          className={primary}
          onClick={() =>
            handlers.onCancel(instance ? instance.id : entry.serverName)
          }
        >
          {t("connectors.action.cancel")}
        </button>
        {disconnectButton}
      </>
    );
  }

  if (!instance) {
    return (
      <button
        type="button"
        className={primary}
        onClick={() => handlers.onConnect(entry.serverName)}
      >
        {t("connectors.action.connect")}
      </button>
    );
  }

  switch (instance.status.kind) {
    case "ready":
      return disconnectButton;

    case "idle":
      // 已配置但当前没有连接活动。给「连接」重试授权，并保留退路。
      return (
        <>
          <button
            type="button"
            className={primary}
            onClick={() => handlers.onAuthorize(instance.id)}
          >
            {t("connectors.action.connect")}
          </button>
          {disconnectButton}
        </>
      );

    case "authorized":
      // 凭据已在本地，等运行时接手（下次会话自动连上）。**不给主按钮**：
      // 这个状态意味着没有活跃会话，而 activateNow 在没有会话时直接返回 false
      // —— 按钮按下去什么也不会发生。在「已授权」旁边放「立即连接」既无用又矛盾。
      // 用户需要知道的是「接下来会发生什么」，那由状态行负责说清。
      return disconnectButton;

    case "connecting":
      // 传输适配器在连接 / 等授权，但本地没有对应的授权流程 ——
      // `cancelSignIn` 此时找不到东西可中止。只保留「断开」这条退路，
      // 真正的授权取消走上面的 `authorizing` 分支。
      return disconnectButton;

    case "needs-auth":
      return (
        <>
          <button
            type="button"
            className={primary}
            onClick={() => handlers.onAuthorize(instance.id)}
          >
            {t("connectors.action.reauthorize")}
          </button>
          {disconnectButton}
        </>
      );

    case "failed":
      return (
        <>
          <button
            type="button"
            className={ghost}
            onClick={() => handlers.onAuthorize(instance.id)}
          >
            {t("connectors.action.retry")}
          </button>
          {disconnectButton}
        </>
      );

    case "off":
      // 目前不可达：`off` 只由内置预设产生（enabled:false），而那是 capability 条目，
      // 走上面的开关分支。留着是因为 renderAction 的 switch 必须穷尽 ConnectorStatus
      // —— 将来远程 server 支持「停用」时，这里就是它该落的地方。
      return (
        <>
          <button
            type="button"
            className={primary}
            onClick={() => handlers.onConnect(entry.serverName)}
          >
            {t("connectors.action.connect")}
          </button>
          {disconnectButton}
        </>
      );
  }
}
