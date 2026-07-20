import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { SettingsSkills } from "./settings/SettingsSkills";
import { CloudApiClient } from "../services/cloud-api";

export function MarketplaceView() {
  const { t } = useTranslation();
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

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 lg:px-8"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="max-w-[920px] w-full min-w-0 mx-auto">
          <SettingsSkills isActive={true} />
        </div>
      </div>
    </div>
  );
}
