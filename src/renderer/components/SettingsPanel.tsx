import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Bot,
  Settings,
  Shield,
  Wifi,
  AlertCircle,
  Cpu,
  Globe,
  type LucideIcon,
  BrainCircuit,
  Archive,
  Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWindowSize } from "../hooks/useWindowSize";
import { RemoteControlPanel } from "./RemoteControlPanel";
import { useAppStore } from "../store";
import { SettingsAPI } from "./settings/SettingsAPI";
import { SubagentSettings } from "./settings/SubagentSettings";
import { SettingsSandbox } from "./settings/SettingsSandbox";
import { SettingsGeneral } from "./settings/SettingsGeneral";
import { SettingsCapabilities } from "./settings/SettingsCapabilities";
import { SettingsLogs } from "./settings/SettingsLogs";
import { SettingsPersonalization } from "./settings/SettingsPersonalization";
import { SettingsArchived } from "./settings/SettingsArchived";
import { SettingsAbout } from "./settings/SettingsAbout";

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?:
    | "capabilities"
    | "api"
    | "subagent"
    | "sandbox"
    | "personalization"
    | "remote"
    | "logs"
    | "general"
    | "archived"
    | "about";
}

type TabId =
  | "capabilities"
  | "api"
  | "subagent"
  | "sandbox"
  | "personalization"
  | "remote"
  | "logs"
  | "general"
  | "archived"
  | "about";

type TabGroupId = "general" | "personal" | "integrations" | "other";

/** 侧栏一格。group 必填：从 tabs 派生的分组才不会漏掉新加的 tab。 */
type SettingsTab = {
  id: TabId;
  label: string;
  icon: LucideIcon;
  description: string;
  group: TabGroupId;
};

const SHOW_SANDBOX_TAB = false;

const VALID_TABS = new Set<TabId>([
  "capabilities",
  "api",
  "subagent",
  ...(SHOW_SANDBOX_TAB ? (["sandbox"] as TabId[]) : []),
  "personalization",
  "remote",
  "logs",
  "general",
  "archived",
  "about",
]);

export function SettingsPanel({
  onClose,
  initialTab = "general",
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const { width } = useWindowSize();
  const compactSidebar = width < 900;
  // Read settingsTab from store at mount time so external navigation (nav-server)
  // takes effect even before this component mounts.
  const storeTab = useAppStore((s) => s.settingsTab);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const resolvedInitial =
    storeTab && VALID_TABS.has(storeTab as TabId)
      ? (storeTab as TabId)
      : initialTab;

  const [activeTab, setActiveTab] = useState<TabId>(resolvedInitial);
  // Track which tabs have been viewed at least once (for lazy loading)
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(
    new Set([resolvedInitial]),
  );
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVersion);
      else if (v) setAppVersion(v);
    } catch {
      /* ignore */
    }
  }, []);

  // Consume the store signal and apply tab in one effect
  useEffect(() => {
    if (storeTab && VALID_TABS.has(storeTab as TabId)) {
      setActiveTab(storeTab as TabId);
      setSettingsTab(null);
    }
  }, [storeTab, setSettingsTab]);

  // Mark tab as viewed when it becomes active
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs((prev) => new Set([...prev, activeTab]));
    }
  }, [activeTab]);

  const tabs: SettingsTab[] = [
    {
      id: "general" as TabId,
      label: t("settings.general"),
      icon: Globe,
      description: t("settings.generalDesc"),
      group: "general",
    },
    {
      id: "capabilities" as TabId,
      label: t("settings.capabilitiesTitle"),
      icon: Cpu,
      description: t("settings.capabilitiesDesc"),
      group: "integrations",
    },
    {
      id: "api" as TabId,
      label: t("settings.apiSettings"),
      icon: Settings,
      description: t("settings.apiSettingsDesc"),
      group: "personal",
    },
    {
      id: "subagent" as TabId,
      label: t("subagent.title"),
      icon: Bot,
      description: t("settings.subagentDesc"),
      group: "personal",
    },
    ...(SHOW_SANDBOX_TAB
      ? ([
          {
            id: "sandbox" as TabId,
            label: t("settings.sandbox"),
            icon: Shield,
            description: t("settings.sandboxDesc"),
            group: "integrations",
          },
        ] satisfies SettingsTab[])
      : []),
    {
      id: "personalization" as TabId,
      label: t("settings.personalization"),
      icon: BrainCircuit,
      description: t("settings.personalizationDesc"),
      group: "personal",
    },
    {
      id: "remote" as TabId,
      label: t("settings.remote", "远程控制"),
      icon: Wifi,
      description: t("settings.remoteDesc", "通过已连接的频道远程使用"),
      group: "integrations",
    },
    {
      id: "logs" as TabId,
      label: t("settings.logs"),
      icon: AlertCircle,
      description: t("settings.logsDesc"),
      group: "other",
    },
    {
      id: "archived" as TabId,
      label: t("settings.archivedSessions"),
      icon: Archive,
      description: t("settings.archivedSessionsDesc"),
      group: "personal",
    },
    {
      id: "about" as TabId,
      label: t("settings.about"),
      icon: Info,
      description: t("settings.aboutDesc"),
      group: "other",
    },
  ];
  // 分组表只列组名与顺序，条目从 tabs 过滤得来 —— 单一真相。新增 tab 必须带 group
  // （类型强制），所以不会再出现「加进 tabs 却漏进分组、用户永远点不到」。
  const tabGroups: Array<{ key: TabGroupId; label: string }> = [
    { key: "general", label: t("settings.groupGeneral") },
    { key: "personal", label: t("settings.groupPersonal") },
    { key: "integrations", label: t("settings.groupIntegrations") },
    { key: "other", label: t("settings.groupOther") },
  ];
  const groupedTabs = tabGroups
    .map((group) => ({
      ...group,
      tabs: tabs.filter((tab) => tab.group === group.key),
    }))
    .filter((group) => group.tabs.length > 0);
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <div
        className={`${compactSidebar ? "w-14" : "w-[220px]"} bg-background-secondary/80 flex flex-col flex-shrink-0`}
      >
        {/* Back button — settings top-left */}
        <div
          className={
            compactSidebar ? "flex justify-center pt-3 pb-1" : "px-4 pt-4 pb-0"
          }
        >
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors inline-flex"
          >
            <ArrowLeft className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
        {!compactSidebar && (
          <div className="px-5 pt-1 pb-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("settings.title")}
            </h2>
          </div>
        )}
        <div
          className={`flex-1 overflow-y-auto ${
            compactSidebar ? "p-1.5" : "px-3 py-1"
          }`}
        >
          {groupedTabs.map((group) => (
            <div
              key={group.key}
              className={compactSidebar ? "space-y-1 py-1" : "py-1.5"}
            >
              {!compactSidebar && (
                <div className="px-2.5 pb-1 text-xs text-text-muted">
                  {group.label}
                </div>
              )}
              <div className={compactSidebar ? "space-y-1" : "space-y-0.5"}>
                {group.tabs.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      title={compactSidebar ? tab.label : undefined}
                      aria-label={tab.label}
                      aria-current={active ? "page" : undefined}
                      className={`flex w-full items-center rounded-lg transition-colors active:scale-[0.98] ${
                        compactSidebar
                          ? "justify-center p-2.5"
                          : "gap-2.5 px-2.5 py-2"
                      } ${
                        active
                          ? "bg-surface font-medium text-text-primary"
                          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      }`}
                    >
                      <tab.icon className="h-4 w-4 flex-shrink-0" />
                      {!compactSidebar && (
                        <span className="truncate text-sm">{tab.label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {!compactSidebar && (
          <div className="p-4">
            <p className="text-xs text-text-muted text-center mt-2 select-text">
              v{appVersion}
            </p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex flex-shrink-0 items-center gap-3 bg-background/90 px-4 py-4 lg:px-8">
          <div>
            <h3 className="text-2xl font-semibold text-text-primary">
              {activeTabMeta?.label}
            </h3>
            {activeTabMeta?.description && (
              <p className="mt-1 text-sm text-text-muted">
                {activeTabMeta.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-8 lg:px-8">
          {/*
            api tab 不在这里封顶：它下面四个子 tab 想要的宽度不同
            （主模型是目录网格，视觉/搜索/轻量是表单），由 SettingsAPI 各自封。
            其余设置页维持「一行一设置」的 720px。
          */}
          <div
            className={`w-full min-w-0 ${
              activeTab === "api" ? "" : "max-w-[720px]"
            }`}
          >
            <div className="">
              <div className={activeTab === "api" ? "" : "hidden"}>
                {viewedTabs.has("api") && (
                  <>
                    <SettingsAPI />
                  </>
                )}
              </div>
              <div className={activeTab === "subagent" ? "" : "hidden"}>
                {viewedTabs.has("subagent") && <SubagentSettings />}
              </div>
              {SHOW_SANDBOX_TAB && (
                <div className={activeTab === "sandbox" ? "" : "hidden"}>
                  {viewedTabs.has("sandbox") && <SettingsSandbox />}
                </div>
              )}
              <div className={activeTab === "personalization" ? "" : "hidden"}>
                {viewedTabs.has("personalization") && (
                  <SettingsPersonalization />
                )}
              </div>
              <div className={activeTab === "remote" ? "" : "hidden"}>
                {viewedTabs.has("remote") && (
                  <RemoteControlPanel isActive={activeTab === "remote"} />
                )}
              </div>
              <div className={activeTab === "logs" ? "" : "hidden"}>
                {viewedTabs.has("logs") && (
                  <SettingsLogs isActive={activeTab === "logs"} />
                )}
              </div>
              <div className={activeTab === "general" ? "" : "hidden"}>
                {viewedTabs.has("general") && <SettingsGeneral />}
              </div>
              <div className={activeTab === "capabilities" ? "" : "hidden"}>
                {viewedTabs.has("capabilities") && (
                  <SettingsCapabilities
                    isActive={activeTab === "capabilities"}
                  />
                )}
              </div>
              <div className={activeTab === "archived" ? "" : "hidden"}>
                {viewedTabs.has("archived") && <SettingsArchived />}
              </div>
              <div className={activeTab === "about" ? "" : "hidden"}>
                {viewedTabs.has("about") && (
                  <SettingsAbout appVersion={appVersion} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
