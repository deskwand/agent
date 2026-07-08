import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Plug, Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { SettingsConnectors } from "./settings/SettingsConnectors";
import { SettingsSkills } from "./settings/SettingsSkills";
import { CloudApiClient } from "../services/cloud-api";

type TabId = string;

export function MarketplaceView() {
  const { t } = useTranslation();
  const storeTab = useAppStore((s) => s.marketplaceTab);
  const setMarketplaceTab = useAppStore((s) => s.setMarketplaceTab);
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);
  const cloudConfig = useAppStore((s) => s.cloudConfig);
  const setActiveTeamId = useAppStore((s) => s.setActiveTeamId);
  const setActiveTeamName = useAppStore((s) => s.setActiveTeamName);
  const prevTokenRef = useRef<string | undefined>();

  // Fetch team on login
  useEffect(() => {
    const token = cloudConfig?.token;
    if (!token) {
      setActiveTeamId(null);
      setActiveTeamName("");
      prevTokenRef.current = undefined;
      return;
    }
    if (token === prevTokenRef.current) return;
    prevTokenRef.current = token;
    const client = new CloudApiClient(token);
    client
      .getTeams()
      .then((teams) => {
        if (teams.length > 0) {
          setActiveTeamId(teams[0].id);
          setActiveTeamName(teams[0].name);
        } else {
          setActiveTeamId(null);
          setActiveTeamName("");
        }
      })
      .catch((err: unknown) => {
        const e = err as Error & { status?: number };
        if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      });
  }, [cloudConfig?.token, setActiveTeamId]);

  // Build dynamic tabs
  const tabs: Array<{ id: TabId; label: string; icon: typeof Package }> = [];

  // My Skills tab (always visible)
  tabs.push({
    id: "my-skills",
    label: t("skillMarket.tabMySkills"),
    icon: Package,
  });
  // MCP tab (always visible)
  tabs.push({
    id: "connectors",
    label: t("marketplace.tabMCP"),
    icon: Plug,
  });

  // Active tab — start with my-skills
  const defaultTab = "my-skills";

  const [activeTab, setActiveTab] = useState<TabId>(
    (() => {
      if (storeTab === "connectors") return "connectors";
      if (storeTab === "skills") return "my-skills";
      return defaultTab;
    })()
  );
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(
    new Set([activeTab])
  );

  // External navigation
  useEffect(() => {
    if (storeTab === "skills") {
      setActiveTab("my-skills");
      setMarketplaceTab(null);
    } else if (storeTab === "connectors") {
      setActiveTab("connectors");
      setMarketplaceTab(null);
    }
  }, [storeTab, setMarketplaceTab]);

  // Mark tab as viewed
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs((prev) => new Set([...prev, activeTab]));
    }
  }, [activeTab]);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      let nextIndex: number | null = null;
      if (e.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      }
      if (nextIndex !== null) {
        e.preventDefault();
        setActiveTab(tabs[nextIndex].id);
      }
    },
    [activeTab, tabs]
  );

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-0 flex-shrink-0">
        <button
          onClick={() => setShowMarketplace(false)}
          aria-label={t("common.back")}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-text-primary">
          {t("marketplace.title")}
        </h2>
      </div>

      {/* Horizontal tabs */}
      <nav
        role="tablist"
        className="flex items-center gap-0 px-5 mt-3 border-b border-border-primary flex-shrink-0"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={handleTabKeyDown}
            className={`flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-colors duration-200 border-b-2 -mb-[1px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent rounded-t-sm ${
              activeTab === tab.id
                ? "text-text-primary border-accent"
                : "text-text-muted border-transparent hover:text-text-secondary"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 lg:px-8" style={{ scrollbarGutter: "stable" }}>
        <div className="max-w-[920px] w-full min-w-0 mx-auto">
          <div className={activeTab === "my-skills" ? "" : "hidden"}>
            {viewedTabs.has("my-skills") && (
              <SettingsSkills isActive={activeTab === "my-skills"} />
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
  );
}
