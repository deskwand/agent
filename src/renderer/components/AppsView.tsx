import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { SettingsSkills } from "./settings/SettingsSkills";
import { PiExtensionManagerView } from "./PiExtensionManagerView";
import { CloudApiClient } from "../services/cloud-api";

type AppsTab = "skills" | "plugins";

export function AppsView() {
  const { t } = useTranslation();
  const setShowApps = useAppStore((s) => s.setShowApps);
  const cloudConfig = useAppStore((s) => s.cloudConfig);
  const setActiveTeamId = useAppStore((s) => s.setActiveTeamId);
  const setActiveTeamName = useAppStore((s) => s.setActiveTeamName);
  const prevTokenRef = useRef<string | undefined>();
  const [activeTab, setActiveTab] = useState<AppsTab>("plugins");

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

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-0 flex-shrink-0">
        <button
          onClick={() => setShowApps(false)}
          aria-label={t("common.back")}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-text-primary">
          {t("apps.title")}
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-5 pt-3 flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("skills")}
          aria-current={activeTab === "skills" ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "skills"
              ? "bg-surface-active text-text-primary"
              : "text-text-secondary hover:bg-surface-hover/60"
          }`}
        >
          {t("marketplace.title")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("plugins")}
          aria-current={activeTab === "plugins" ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "plugins"
              ? "bg-surface-active text-text-primary"
              : "text-text-secondary hover:bg-surface-hover/60"
          }`}
        >
          {t("plugins.title")}
        </button>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 lg:px-8"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="w-full min-w-0">
          {activeTab === "skills" ? (
            <SettingsSkills isActive={true} />
          ) : (
            <PiExtensionManagerView />
          )}
        </div>
      </div>
    </div>
  );
}
