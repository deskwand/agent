import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Plug, Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { SettingsConnectors } from "./settings/SettingsConnectors";
import { SettingsSkills } from "./settings/SettingsSkills";

type TabId = "connectors" | "skills" | "plugins";

export function MarketplaceView() {
  const { t } = useTranslation();
  const storeTab = useAppStore((s) => s.marketplaceTab);
  const setMarketplaceTab = useAppStore((s) => s.setMarketplaceTab);
  const setShowMarketplace = useAppStore((s) => s.setShowMarketplace);

  const [activeTab, setActiveTab] = useState<TabId>(
    storeTab === "connectors" ? "connectors" : "skills",
  );
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(
    new Set([storeTab === "connectors" ? "connectors" : "skills"] as TabId[]),
  );

  // Consume store signal for external navigation
  useEffect(() => {
    if (
      storeTab === "skills" ||
      storeTab === "connectors" ||
      storeTab === "plugins"
    ) {
      setActiveTab(storeTab);
      setMarketplaceTab(null);
    }
  }, [storeTab, setMarketplaceTab]);

  // Mark tab as viewed
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs((prev) => new Set([...prev, activeTab]));
    }
  }, [activeTab]);

  const tabs = [
    {
      id: "skills" as TabId,
      label: t("marketplace.tabSkills"),
      icon: Package,
    },
    {
      id: "connectors" as TabId,
      label: t("marketplace.tabMCP"),
      icon: Plug,
    },
  ];

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
    [activeTab],
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 lg:px-8">
        <div className="max-w-[920px] w-full min-w-0 mx-auto">
          <div className={activeTab === "skills" ? "" : "hidden"}>
            {viewedTabs.has("skills") && (
              <SettingsSkills isActive={activeTab === "skills"} />
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
