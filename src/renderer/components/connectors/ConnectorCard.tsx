import { useTranslation } from "react-i18next";
import type {
  ConnectorEntry,
  ConnectorInstance,
} from "../../../shared/connectors";

interface Props {
  entry: ConnectorEntry;
  /** "grid" 是发现视图（卡片），"row" 是管理视图（紧凑行）。见设计文档 D12。 */
  variant?: "grid" | "row";
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

  const shell = isRow
    ? "bg-surface border border-border-muted rounded-lg px-3.5 py-3 flex items-center gap-3"
    : "bg-surface border border-border-muted rounded-container p-3.5 flex flex-col gap-2.5 shadow-card hover:bg-surface-hover min-h-[132px]";

  return (
    <div className={shell}>
      <div
        className={
          isRow
            ? "flex items-center gap-3 flex-1 min-w-0"
            : "flex items-start gap-2.5"
        }
      >
        <div
          className={`${isRow ? "w-7 h-7 text-xs" : "w-8 h-8 text-sm"} rounded-lg bg-accent-muted text-accent grid place-items-center font-bold flex-none`}
        >
          {t(entry.nameKey).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">
            {t(entry.nameKey)}
          </div>
          {entry.descriptionKey && !isRow && (
            <div className="text-xs text-text-muted mt-0.5 line-clamp-2">
              {t(entry.descriptionKey)}
            </div>
          )}
          {isRow && instance && (
            <div className="text-xs text-text-muted mt-0.5 truncate">
              {t(instance.summary)}
            </div>
          )}
        </div>
      </div>

      <div
        className={
          isRow
            ? "flex items-center gap-3 flex-none"
            : "flex items-center justify-between gap-2 mt-auto"
        }
      >
        {isCapability ? (
          <>
            {!isRow && (
              <span className="text-xs text-text-secondary">
                {instance
                  ? statusText(instance.status, t)
                  : t("connectors.status.off")}
              </span>
            )}
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
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-xs text-text-secondary min-w-0">
              {instance && (
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-none ${dotClass(instance.status.kind)}`}
                />
              )}
              <span className="truncate">
                {instance
                  ? statusText(instance.status, t)
                  : t("connectors.status.off")}
              </span>
            </span>
            {renderAction(entry, instance, t, {
              onConnect,
              onDisconnect,
              onAuthorize,
              onCancel,
            })}
          </>
        )}
      </div>
    </div>
  );
}

function renderAction(
  entry: ConnectorEntry,
  instance: ConnectorInstance | undefined,
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

  // 规则：只要已添加，就永远给一条退路（「断开」）。
  // 之前 `connecting` 只给一个禁用按钮 —— 用户不能取消、不能重试、不能断开，
  // 只能手动去改 mcp.json。任何状态都不该把人困住。
  const disconnectButton = (
    <button
      type="button"
      className={ghost}
      onClick={() => handlers.onDisconnect(instance.id)}
    >
      {t("connectors.action.disconnect")}
    </button>
  );

  switch (instance.status.kind) {
    case "ready":
      return disconnectButton;

    case "idle":
      // 已配置但当前没有连接活动（例如没开会话）。给「连接」重试授权，并保留退路。
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

    case "connecting":
      // 正在授权/连接：必须能中止，否则用户要干等最多 5 分钟的超时。
      return (
        <>
          <button
            type="button"
            className={primary}
            onClick={() => handlers.onCancel(instance.id)}
          >
            {t("connectors.action.cancel")}
          </button>
          {disconnectButton}
        </>
      );

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
