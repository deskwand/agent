import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Settings,
  Shield,
  Wifi,
  AlertCircle,
  Globe,
  ChevronRight,
  BrainCircuit,
  Archive,
  Info,
  Plug,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWindowSize } from "../hooks/useWindowSize";
import { RemoteControlPanel } from "./RemoteControlPanel";
import { useAppStore } from "../store";
import { SettingsAPI } from "./settings/SettingsAPI";
import { SettingsSandbox } from "./settings/SettingsSandbox";
import { SettingsGeneral } from "./settings/SettingsGeneral";
import { SettingsLogs } from "./settings/SettingsLogs";
import { SettingsMemory } from "./settings/SettingsMemory";
import { SettingsArchived } from "./settings/SettingsArchived";
import { SettingsAbout } from "./settings/SettingsAbout";
import { SettingsConnectors } from "./settings/SettingsConnectors";

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?:
    | "api"
    | "sandbox"
    | "memory"
    | "remote"
    | "logs"
    | "general"
    | "archived"
    | "about"
    | "connectors";
}

type TabId =
  | "api"
  | "sandbox"
  | "memory"
  | "remote"
  | "logs"
  | "general"
  | "archived"
  | "about"
  | "connectors";

const SHOW_SANDBOX_TAB = false;

const VALID_TABS = new Set<TabId>([
  "api",
  ...(SHOW_SANDBOX_TAB ? (["sandbox"] as TabId[]) : []),
  "memory",
  "remote",
  "logs",
  "general",
  "archived",
  "about",
  "connectors",
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

  const tabs = [
    {
      id: "general" as TabId,
      label: t("settings.general"),
      icon: Globe,
      description: t("settings.generalDesc"),
    },
    {
      id: "api" as TabId,
      label: t("settings.apiSettings"),
      icon: Settings,
      description: t("settings.apiSettingsDesc"),
    },
    ...(SHOW_SANDBOX_TAB
      ? [
          {
            id: "sandbox" as TabId,
            label: t("settings.sandbox"),
            icon: Shield,
            description: t("settings.sandboxDesc"),
          },
        ]
      : []),
    {
      id: "memory" as TabId,
      label: t("settings.memory"),
      icon: BrainCircuit,
      description: t("settings.memoryDesc"),
    },
    {
      id: "remote" as TabId,
      label: t("settings.remote", "远程控制"),
      icon: Wifi,
      description: t("settings.remoteDesc", "通过飞书等平台远程使用"),
    },
    {
      id: "logs" as TabId,
      label: t("settings.logs"),
      icon: AlertCircle,
      description: t("settings.logsDesc"),
    },
    {
      id: "archived" as TabId,
      label: t("settings.archivedSessions"),
      icon: Archive,
      description: t("settings.archivedSessionsDesc"),
    },
    {
      id: "about" as TabId,
      label: t("settings.about"),
      icon: Info,
      description: t("settings.aboutDesc"),
    },
    {
      id: "connectors" as TabId,
      label: t("marketplace.tabMCP"),
      icon: Plug,
      description: t("settings.connectorsDesc"),
    },
  ];
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <div
        className={`${compactSidebar ? "w-14" : "w-52 lg:w-60"} bg-background-secondary/80 flex flex-col flex-shrink-0`}
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
          <div className="px-4 pt-1 pb-4">
            <p className="text-xs uppercase tracking-[0.16em] text-text-muted">
              {t("settings.title")}
            </p>
            <h2 className="mt-1 text-sm font-bold tracking-[-0.03em] text-text-primary">
              DeskWand
            </h2>
            <p className="mt-1 text-xs leading-4 text-text-muted">
              {t("settings.panelDesc")}
            </p>
          </div>
        )}
        <div
          className={`flex-1 overflow-y-auto ${compactSidebar ? "p-1.5 space-y-1" : "p-3 space-y-1.5"}`}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={compactSidebar ? tab.label : undefined}
              className={`w-full flex items-center ${compactSidebar ? "justify-center p-2.5" : "gap-3 px-3.5 py-3"} rounded-lg text-left transition-colors active:scale-[0.98] border-l-2 ${
                activeTab === tab.id
                  ? "bg-accent/10 text-text-primary font-medium border-accent"
                  : "hover:bg-surface-hover text-text-secondary hover:text-text-primary border-transparent"
              }`}
            >
              <tab.icon className="w-4.5 h-4.5 flex-shrink-0" />
              {!compactSidebar && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tab.label}</p>
                  <p className="text-xs leading-4 text-text-muted line-clamp-2 mt-0.5">
                    {tab.description}
                  </p>
                </div>
              )}
              {!compactSidebar && (
                <ChevronRight
                  className={`w-4 h-4 flex-shrink-0 transition-opacity ${activeTab === tab.id ? "opacity-100" : "opacity-0"}`}
                />
              )}
            </button>
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
        <div className="flex items-center gap-3 px-4 lg:px-8 py-4 flex-shrink-0 bg-background/88">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-text-muted">
              {t("settings.title")}
            </p>
            <h3 className="mt-1 text-sm font-semibold tracking-[-0.02em] text-text-primary">
              {activeTabMeta?.label}
            </h3>
            {activeTabMeta?.description && (
              <p className="mt-1 text-sm text-text-muted max-w-[36rem]">
                {activeTabMeta.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-8 lg:px-8">
          <div className="max-w-[920px] w-full min-w-0 mx-auto">
            <div className="">
              <div className={activeTab === "api" ? "" : "hidden"}>
                {viewedTabs.has("api") && (
                  <>
                    <SettingsAPI />
                  </>
                )}
              </div>
              {SHOW_SANDBOX_TAB && (
                <div className={activeTab === "sandbox" ? "" : "hidden"}>
                  {viewedTabs.has("sandbox") && <SettingsSandbox />}
                </div>
              )}
              <div className={activeTab === "memory" ? "" : "hidden"}>
                {viewedTabs.has("memory") && <SettingsMemory />}
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
              <div className={activeTab === "archived" ? "" : "hidden"}>
                {viewedTabs.has("archived") && <SettingsArchived />}
              </div>
              <div className={activeTab === "about" ? "" : "hidden"}>
                {viewedTabs.has("about") && (
                  <SettingsAbout appVersion={appVersion} />
                )}
              </div>
              <div className={activeTab === "connectors" ? "" : "hidden"}>
                {viewedTabs.has("connectors") && (
                  <SettingsConnectors isActive={activeTab === "connectors"} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
