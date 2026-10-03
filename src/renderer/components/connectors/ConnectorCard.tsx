import { useTranslation } from "react-i18next";
import { FirstPartyServiceIcon, serviceIconFor } from "./brand-icons";
import type {
  ConnectorEntry,
  ConnectorInstance,
} from "../../../shared/connectors";

interface Props {
  entry: ConnectorEntry;
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

/**
 * 状态颜色 —— 原先是一个彩色圆点，但圆点要么占位（让「未启用」比名称多缩进一格，
 * 显得没对齐）、要么只在有状态时才出现（那又会让各行文字左右不齐）。
 * 改成给**状态文字本身**上色：信息保留，缩进与对齐都正常。
 */
function statusTextClass(kind: ConnectorInstance["status"]["kind"]): string {
  switch (kind) {
    case "ready":
      return "text-success";
    case "authorized":
      return "text-success/80";
    case "connecting":
      return "text-accent";
    case "needs-auth":
      return "text-warning";
    case "failed":
      return "text-error";
    case "idle":
    case "off":
      return "text-text-muted";
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
  authorizing = false,
  onConnect,
  onDisconnect,
  onAuthorize,
  onCancel,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const instance = entry.instances[0];
  // 本机（stdio）卡片画开关，远程（http）画连接/断开。
  // 判据用 **entry 级** 的 transport —— 未添加的内置条目 instances 为空，
  // 那时也要画对动作。
  const isCapability = entry.transport === "stdio";
  /** 没有实例 = 还没添加过，视为关闭；开关照样可点。 */
  const capabilityOn = !!instance && instance.status.kind !== "off";
  const name = t(entry.nameKey);
  /** 头像画什么：厂商 logo / 自研图形 / 首字母兜底。名字匹配全在 brand-icons 里，卡片不写名字常量。 */
  const icon = serviceIconFor(entry.serverName);
  /** 厂商 logo 的 url —— 白底只给这一支，不是厂商时为 null（见下方头像处）。 */
  const brandIconUrl = icon?.kind === "brand" ? icon.url : null;

  /** 传输层状态文案；能力开关卡片也用它（开关卡片没有 OAuth 流程，不看 authorizing）。 */
  const instanceStatus = instance
    ? statusText(instance.status, t)
    : t("connectors.status.off");
  /** 本地待授权优先于传输状态。 */
  const statusLabel = authorizing
    ? t("connectors.status.connecting")
    : instanceStatus;
  const statusKind = authorizing
    ? "connecting"
    : (instance?.status.kind ?? "off");

  // 状态行固定高度（不跳动），但**不留透明占位圆点** —— 那会让「未启用」比名称和描述
  // 多缩进一格，看上去没对齐。状态文字直接与名称/描述左对齐；状态本身用文字表达。
  const statusLine = (
    <span className="flex items-center h-4 text-xs min-w-0">
      <span
        className={`truncate ${statusTextClass(statusKind)}`}
        data-testid="card-status"
      >
        {isCapability ? instanceStatus : statusLabel}
      </span>
    </span>
  );

  /** 传输标记 —— 固定宽度且**永不条件渲染**，替代被删掉的「本机能力」tab 的区分作用。
   *  它排在动作组的**后面**（标题行的最后一个元素）：徽标位置因此与动作宽度无关，
   *  「本机」开关（34px）与「连接」（44px）宽窄不同也不会让徽标在列内漂 12px（用户报过）。
   *  徽标放左边则反过来：得给动作组写个最小宽度兜底，而两按钮状态会超出它（见下）。 */
  const transportBadge = (
    <span
      data-testid="transport-badge"
      className="flex-none w-[34px] text-center text-[10px] leading-4 rounded-sm border border-border-muted text-text-muted"
    >
      {t(
        entry.transport === "stdio"
          ? "connectors.transport.local"
          : "connectors.transport.remote",
      )}
    </span>
  );

  // stdio（本机进程）只给「启用/停用」：**「连接」是 OAuth 授权**，用在 stdio 上必报
  // `not a remote server`；**「断开」会从 mcp.json 删掉配置** —— 对目录条目可接受
  // （能一键加回），对手写的自定义 server 是不可恢复的删除。
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
      onToggle,
    })
  );

  /**
   * 动作组包一层，多个按钮从此不可拆。
   * 它进标题行右侧，与状态文字不在同一个容器 —— 否则任何「两端对齐」的容器
   * 都会把按钮甩到卡片正中（见设计文档 P3）。
   */
  // **宽度完全交给内容**（不写 `w-` / `min-w-` / `max-w-`）：写死 `w-[52px]` 时，
  // 连接/断开、取消/断开、重试/断开这类两按钮状态各分到 22px，减去 `px-2.5` 的 20px
  // 只剩 2px，中文标签一字一行、按钮高 40px 再撑破 `h-5` 标题行（用户报过截图）。
  // 徽标排在它右边（见上），所以内容定宽不会让徽标漂移 —— 两个约束同时成立。
  // **最窄可达列宽 ≈ 346px**（800px 最小窗宽 − rail 56px − `p-5` 两侧 40px，`md:` 两列）：
  // 最宽的动作组「重新授权 + 断开」≈120px 仍有富余；往动作组前面塞东西时要重算。
  const actionGroup = (
    <div className="flex items-center justify-end gap-1.5 flex-none">
      {actions}
    </div>
  );

  // grid：发现视图。名称与动作同一行，说明与状态在内容列里各占一行。
  return (
    <div className="bg-surface border border-border-muted rounded-container p-3.5 flex gap-2.5 shadow-card hover:bg-surface-hover">
      {/* 三分支头像。白底只给厂商 logo（厂商只发布浅底版图）；另两支画的是 text-accent，
          深色主题的 accent 放白底上只有 1.86–3.16:1，所以留着 bg-accent-muted。
          24px 是内缩 4px 后的图形区；六个图标都是 24×24 viewBox，所以 w-6 h-6 够用。 */}
      <div
        data-testid="card-avatar"
        className={`w-8 h-8 rounded-lg grid place-items-center flex-none ${
          brandIconUrl ? "bg-white border border-border" : "bg-accent-muted"
        }`}
      >
        {brandIconUrl ? (
          <img src={brandIconUrl} alt="" className="w-6 h-6" />
        ) : icon?.kind === "firstParty" ? (
          <span className="text-accent grid place-items-center">
            <FirstPartyServiceIcon />
          </span>
        ) : (
          <span className="text-sm font-bold text-accent">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 h-5">
          <div className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate">
            {name}
          </div>
          {actionGroup}
          {transportBadge}
        </div>
        {/* 单行截断 + 固定高度：多行会让同排卡片高度不齐，状态一变就跳 */}
        <div className="h-4 text-xs text-text-muted truncate">
          {entry.descriptionKey ? t(entry.descriptionKey) : ""}
        </div>
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
    onToggle: (instanceId: string, enabled: boolean) => void;
  },
) {
  // **stdio（本机进程）只给「启用/停用」**，不给「连接/断开」：
  // **whitespace-nowrap 是硬约束**：中文标签一旦分到小于一个字宽的盒子就会竖排。
  // 槽位现在按内容定宽，本来不会挤，但换行与否不该依赖上一层的宽度怎么算出来。
  const primary =
    "px-2.5 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-hover transition-colors whitespace-nowrap";
  const ghost =
    "px-2.5 py-1 text-xs rounded-control border border-border text-text-primary hover:bg-surface-hover transition-colors whitespace-nowrap";

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

  // key 型条目**没有 OAuth 可重走**：「重新授权」会去调 signIn，对着一个
  // 不需要授权的端点只会报错。重试的唯一含义是重新填凭据 —— 也就是重新弹框。
  const retry =
    entry.auth?.kind === "key"
      ? () => handlers.onConnect(entry.serverName)
      : () => handlers.onAuthorize(instance.id);

  switch (instance.status.kind) {
    case "ready":
      return disconnectButton;

    case "idle":
      // 已配置但当前没有连接活动。给「连接」重试授权，并保留退路。
      return (
        <>
          <button type="button" className={primary} onClick={retry}>
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
          <button type="button" className={primary} onClick={retry}>
            {t(
              entry.auth?.kind === "key"
                ? "connectors.action.connect"
                : "connectors.action.reauthorize",
            )}
          </button>
          {disconnectButton}
        </>
      );

    case "failed":
      return (
        <>
          <button type="button" className={ghost} onClick={retry}>
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
