import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectorEntry } from "../../../shared/connectors";
import type {
  CapabilityPermissions,
  PermissionKind,
} from "../../../shared/capabilities";
import { SettingsCard, SettingsRow, SettingsSwitch } from "./shared";

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
      <p className="text-xs leading-5 text-text-muted">
        {t("settings.capabilitiesIntro")}
      </p>

      {entries.length > 0 && (
        <SettingsCard>
          {entries.map((entry) => {
            const instance = entry.instances[0];
            const on = !!instance && instance.status.kind !== "off";
            return (
              <SettingsRow
                key={entry.key}
                testId="capability-card"
                title={t(entry.nameKey)}
                description={
                  entry.descriptionKey ? t(entry.descriptionKey) : undefined
                }
                control={
                  <SettingsSwitch
                    testId="capability-toggle"
                    label={t(entry.nameKey)}
                    checked={on}
                    onChange={(next) => void onToggle(entry.serverName, next)}
                  />
                }
              />
            );
          })}
        </SettingsCard>
      )}

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
        <div className="space-y-3">
          <SettingsCard>
            {missing.map((kind) => (
              <SettingsRow
                key={kind}
                testId="permission-row"
                title={t(`settings.capabilities.permission.${kind}`)}
                description={t(`settings.capabilities.permission.${kind}Hint`)}
                note={
                  kind === "screen-recording"
                    ? t(
                        "settings.capabilities.permission.screenRecordingRestart",
                      )
                    : undefined
                }
                control={
                  <button
                    type="button"
                    data-testid="permission-open"
                    onClick={() =>
                      void window.electronAPI.capabilities.openPermissionSettings(
                        kind,
                      )
                    }
                    className="rounded-control border border-border px-2.5 py-1 text-xs text-text-primary hover:bg-surface-hover"
                  >
                    {t("settings.capabilities.permission.openSettings")}
                  </button>
                }
              />
            ))}
          </SettingsCard>
          <button
            type="button"
            data-testid="permission-recheck"
            onClick={() => void refresh()}
            className="rounded-control border border-border px-2.5 py-1 text-xs text-text-primary hover:bg-surface-hover"
          >
            {t("settings.capabilities.permission.recheck")}
          </button>
        </div>
      )}
    </div>
  );
}
