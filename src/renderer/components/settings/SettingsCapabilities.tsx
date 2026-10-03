import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectorEntry } from "../../../shared/connectors";
import type {
  CapabilityPermissions,
  PermissionKind,
} from "../../../shared/capabilities";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

/** 逐项渲染的顺序。类型来自 shared，不在界面里另立一套。 */
const PERMISSION_KINDS: readonly PermissionKind[] = [
  "accessibility",
  "screen-recording",
];

/**
 * 设置 → 能力。应用自带的能力（今天只有 Computer Use）住在这里，
 * 不再和外部服务混在连接页里。
 *
 * 数据仍来自 `connectors.list()`：内置能力本来就是一条 MCP server。
 *
 * `isActive`：设置面板会把看过的 tab 一直挂着（`viewedTabs`），所以「切回来」不会
 * 重新挂载。用户去系统设置授权后切回来必须看到新状态 —— 靠这个 prop 触发刷新。
 */
export function SettingsCapabilities({
  isActive = true,
}: {
  isActive?: boolean;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ConnectorEntry[]>([]);
  const [permissions, setPermissions] = useState<CapabilityPermissions | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  /** 「读不到」与「改不动」是两件事，分开报，别互相盖掉。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    // 两个查询各自独立：权限查询失败不该把能力卡（唯一的开关）一起抹掉，
    // 反之亦然。一个 catch 包两个 Promise 就会那样。
    try {
      const list = await window.electronAPI.connectors.list();
      setEntries(list.filter((entry) => entry.source === "mcp-builtin"));
      setLoadFailed(false);
    } catch {
      setEntries([]);
      setLoadFailed(true);
    }
    try {
      setPermissions(await window.electronAPI.capabilities.permissions());
    } catch {
      // 读不到就什么都不显示 —— 不要假装「已授予」，也不要假装「未授予」。
      setPermissions(null);
    }
  }, []);

  useEffect(() => {
    if (isActive) void refresh();
  }, [isActive, refresh]);

  const onToggle = useCallback(
    async (serverName: string, enabled: boolean) => {
      setNotice("");
      setActionError("");
      try {
        const res = await window.electronAPI.connectors.setEnabled(
          serverName,
          enabled,
        );
        if (!res.ok) {
          setActionError(res.error ?? t("settings.capabilities.actionFailed"));
        } else if (res.pendingActivation) {
          // 两个方向都要如实说：会话还开着时，关闭也不会立刻把工具从武器库里拿走。
          setNotice(t("settings.capabilities.pendingActivation"));
        }
      } catch {
        setActionError(t("settings.capabilities.actionFailed"));
      }
      await refresh();
    },
    [refresh, t],
  );

  const missing: PermissionKind[] = permissions?.required
    ? PERMISSION_KINDS.filter((kind) =>
        kind === "accessibility"
          ? !permissions.accessibility
          : !permissions.screenRecording,
      )
    : [];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-text-primary">
        {t("settings.capabilitiesTitle")}
      </h2>
      <p className="text-xs text-text-muted">
        {t("settings.capabilitiesIntro")}
      </p>

      {entries.map((entry) => {
        const instance = entry.instances[0];
        const on = !!instance && instance.status.kind !== "off";
        return (
          <div
            key={entry.key}
            data-testid="capability-card"
            className="bg-surface border border-border-muted rounded-container p-3.5 flex gap-2.5"
          >
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 h-5">
                <div className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate">
                  {t(entry.nameKey)}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={t(entry.nameKey)}
                  data-testid="capability-toggle"
                  onClick={() => void onToggle(entry.serverName, !on)}
                  className={`w-[34px] h-5 rounded-full relative transition-colors flex-none ${
                    on ? "bg-accent" : "bg-surface-active"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                      on ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
              <div className="h-4 text-xs text-text-muted truncate">
                {entry.descriptionKey ? t(entry.descriptionKey) : ""}
              </div>
              <div className="h-4 text-xs text-text-muted">
                {on
                  ? t("settings.capabilities.statusOn")
                  : t("settings.capabilities.statusOff")}
              </div>
            </div>
          </div>
        );
      })}

      {loadFailed && (
        <p className="text-xs text-error" role="alert">
          {t("settings.capabilities.loadFailed")}
        </p>
      )}
      {actionError && (
        <p className="text-xs text-error" role="alert">
          {actionError}
        </p>
      )}
      {notice && <p className="text-xs text-text-secondary">{notice}</p>}

      {missing.length > 0 && (
        <div className="border border-border-muted rounded-container p-3.5 space-y-3">
          <div className="text-sm font-semibold text-text-primary">
            {t("settings.capabilities.permission.title")}
          </div>
          {missing.map((kind) => (
            <div
              key={kind}
              data-testid="permission-row"
              data-permission={kind}
              className="flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-primary">
                  {t(`settings.capabilities.permission.${kind}`)}
                </div>
                <div className="text-xs text-text-muted">
                  {t(`settings.capabilities.permission.${kind}Hint`)}
                </div>
                {kind === "screen-recording" && (
                  <div className="text-xs text-text-muted">
                    {t(
                      "settings.capabilities.permission.screenRecordingRestart",
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                data-testid="permission-open"
                onClick={() =>
                  void window.electronAPI.capabilities.openPermissionSettings(
                    kind,
                  )
                }
                className="flex-none px-2.5 py-1 text-xs rounded-control border border-border text-text-primary"
              >
                {t("settings.capabilities.permission.openSettings")}
              </button>
            </div>
          ))}
          <button
            type="button"
            data-testid="permission-recheck"
            onClick={() => void refresh()}
            className="px-2.5 py-1 text-xs rounded-control border border-border text-text-primary"
          >
            {t("settings.capabilities.permission.recheck")}
          </button>
        </div>
      )}
    </div>
  );
}
