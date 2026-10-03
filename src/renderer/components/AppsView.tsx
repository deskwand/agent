import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { ConnectorsView } from "./connectors/ConnectorsView";
import { CloudApiClient } from "../services/cloud-api";

/**
 * 连接页（rail 的 apps 项）。
 *
 * 三个 tab 由 `ConnectorsView` 自己管：连接 / 技能 / 插件。
 * 这个组件只负责登录后的团队信息预取（原有行为）与页面外壳。
 */
export function AppsView() {
  const { t } = useTranslation();
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
    <div
      className="flex flex-col h-full w-full overflow-hidden bg-background"
      aria-label={t("connectors.title")}
    >
      <ConnectorsView />
    </div>
  );
}
