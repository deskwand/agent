import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectorEntry } from "../../../shared/connectors";
import {
  missingPermissionKinds,
  type CapabilityPermissions,
  type PermissionKind,
} from "../../../shared/capabilities";
import { SettingsCard, SettingsRow, SettingsSwitch } from "./shared";
import { ReadAloudSettings } from "./ReadAloudSettings";
import { VoiceCapabilitySettings } from "./VoiceCapabilitySettings";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

/** 每种权限归哪个能力。纯展示映射：只有本页一个消费者，所以不进 shared。 */
const PERMISSION_OWNERS: Record<PermissionKind, "computerUse" | "voiceInput"> =
  {
    accessibility: "computerUse",
    "screen-recording": "computerUse",
    microphone: "voiceInput",
  };

/**
 * 权限行要长在它服务的那个能力的行下面。Computer Use 的身份是 preset 名
 * （见 `src/main/connectors/sources/mcp-builtin-source.ts`）—— 写死这一个字符串，
 * 好过靠「内置条目只有一个」这个位置假设：加第二个内置能力时权限行不会串到别人名下。
 */
const COMPUTER_USE_SERVER_NAME = "GUI_Operate";

/**
 * 设置 → 能力。一张卡 = 一个能力，卡头就是它的名字。
 * 权限行是它所服务的那个能力的子行（辅助功能/屏幕录制 → Computer Use，麦克风 → 语音输入）。
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

  // 用户去系统设置授权再切回来时，tab 没变、isActive 不会翻 —— 靠窗口焦点重查。
  // 屏幕录制与麦克风由 macOS 按进程缓存，这一步也拿不到新值（文案已说明要重启）。
  useEffect(() => {
    if (!isActive) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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

  // 缺哪些权限由 shared 里的 `missingPermissionKinds` 算 —— 它用
  // `Record<PermissionKind, keyof CapabilityPermissions>` 把 kind 映射到字段，
  // 加第四种权限时必须在那里补一行，不会静默算错。
  //
  // 这里曾经是一个三元链（`kind === "accessibility" ? !a : !screenRecording`），
  // 加 microphone 后它会静默把麦克风未授予报成屏幕录制未授予。
  const missing = missingPermissionKinds(permissions);

  /** 权限行是它所服务的那个能力的子行，所以按 owner 分成两组。 */
  const permissionRows = (owner: "computerUse" | "voiceInput") =>
    missing
      .filter((kind) => PERMISSION_OWNERS[kind] === owner)
      .map((kind) => (
        <SettingsRow
          key={kind}
          testId="permission-row"
          sub
          title={t(`settings.capabilities.permission.${kind}`)}
          note={
            kind === "screen-recording"
              ? `${t(`settings.capabilities.permission.${kind}Hint`)} ${t(
                  "settings.capabilities.permission.screenRecordingRestart",
                )}`
              : t(`settings.capabilities.permission.${kind}Hint`)
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
      ));

  const computerUsePermissions = permissionRows("computerUse");
  const voicePermissions = permissionRows("voiceInput");
  const computerUseEntry = entries.find(
    (entry) => entry.serverName === COMPUTER_USE_SERVER_NAME,
  );

  return (
    <div className="space-y-4">
      {/* 一张卡 = 一个能力，卡头就是它的名字。 */}
      {entries.length > 0 && (
        <SettingsCard>
          {entries.map((entry) => {
            const instance = entry.instances[0];
            const on = !!instance && instance.status.kind !== "off";
            return (
              <Fragment key={entry.key}>
                <SettingsRow
                  testId="capability-card"
                  title={t(entry.nameKey)}
                  description={[
                    entry.descriptionKey ? t(entry.descriptionKey) : "",
                    t("settings.capabilities.sessionToolNote"),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  control={
                    <SettingsSwitch
                      testId="capability-toggle"
                      label={t(entry.nameKey)}
                      checked={on}
                      onChange={(next) => void onToggle(entry.serverName, next)}
                    />
                  }
                />
                {entry === computerUseEntry && computerUsePermissions}
              </Fragment>
            );
          })}
        </SettingsCard>
      )}

      {/* 内置条目读不到、或 Computer Use 不在里面时，权限提示不该跟着消失。 */}
      {!computerUseEntry && computerUsePermissions.length > 0 && (
        <SettingsCard>{computerUsePermissions}</SettingsCard>
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

      <VoiceCapabilitySettings>{voicePermissions}</VoiceCapabilitySettings>
      <ReadAloudSettings />
    </div>
  );
}
