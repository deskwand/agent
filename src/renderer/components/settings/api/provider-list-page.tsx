import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderPresets, ProviderProfileKey } from "../../../types";
import { Button } from "../../app-button";
import {
  hostOf,
  oauthProviderIdForProfile,
  rowBrand,
  type ConfiguredProviderRow,
} from "../configured-provider-list";
import { OAUTH_PROVIDERS } from "../provider-catalog";
import { ProviderBrandIcon } from "../provider-icons";
import { SettingsCard } from "../shared";

export interface ProviderListPageProps {
  rows: ConfiguredProviderRow[];
  activeProfileKey: ProviderProfileKey;
  presets: ProviderPresets;
  oauthStatuses: Record<string, { loggedIn: boolean; providerName: string }>;
  onOpen: (profileKey: ProviderProfileKey) => void;
  onAdd: () => void;
  onSetActive: (profileKey: ProviderProfileKey) => void;
  onDelete: (profileKey: ProviderProfileKey) => void;
  onDisconnect: (providerId: string) => void;
}

/** 界面展示用打码：保留末四位；短串整串打码，免得从长度反推。 */
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length < 8) return "••••••";
  return `sk-•••••${trimmed.slice(-4)}`;
}

export function ProviderListPage({
  rows,
  activeProfileKey,
  presets,
  oauthStatuses,
  onOpen,
  onAdd,
  onSetActive,
  onDelete,
  onDisconnect,
}: ProviderListPageProps) {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <SettingsCard>
        <div className="px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {t("api.configuredListEmptyTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("api.configuredListEmpty")}
          </p>
          <Button
            variant="ghost"
            type="button"
            data-testid="provider-list-add"
            onClick={onAdd}
            className="mt-4 inline-flex h-auto items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("api.addApi")}
          </Button>
        </div>
      </SettingsCard>
    );
  }

  return (
    <div className="space-y-3">
      <SettingsCard>
        {rows.map(({ profileKey, config }) => {
          const oauthId = oauthProviderIdForProfile(profileKey);
          const status = oauthId ? oauthStatuses[oauthId] : undefined;
          const oauthProvider = oauthId
            ? OAUTH_PROVIDERS.find((p) => p.id === oauthId)
            : undefined;
          const modelCount = config.models?.length ?? 0;
          const displayName =
            config.name ||
            oauthProvider?.name ||
            (config.provider === "custom"
              ? t("api.otherProvider")
              : (presets as unknown as Record<string, { name?: string }>)[
                  config.provider
                ]?.name) ||
            config.provider;
          const source = hostOf(config.baseUrl) || displayName;
          const subtitle = [
            status?.loggedIn
              ? t("api.rowSubtitleOauth", { models: modelCount })
              : t("api.rowSubtitle", { source, models: modelCount }),
            modelCount === 0 && !status?.loggedIn ? t("api.rowNoModels") : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const rightText = status?.loggedIn
            ? t("api.oauthConnected")
            : maskSecret(config.apiKey);
          const statusTone =
            modelCount === 0 && !status?.loggedIn ? "bg-warning" : "bg-success";
          const isActive = profileKey === activeProfileKey;
          const menuOpen = openMenu === profileKey;

          return (
            <div
              key={profileKey}
              className="relative flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-hover-surface"
            >
              <button
                type="button"
                data-testid={`configured-provider-${profileKey}`}
                aria-label={displayName}
                onClick={() => onOpen(profileKey as ProviderProfileKey)}
                className="absolute inset-0 rounded-none bg-transparent"
              />
              <span className="relative z-10 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-muted">
                <ProviderBrandIcon
                  brand={rowBrand(profileKey, config)}
                  className="h-5 w-5"
                />
              </span>
              <div className="relative z-10 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {displayName}
                  </span>
                  {isActive && (
                    <span className="flex-none rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary-text">
                      {t("api.activeSetTag")}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {subtitle}
                </div>
              </div>
              <div className="relative z-10 flex flex-none items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${statusTone}`} />
                <span className="font-mono text-xs text-muted-foreground">
                  {rightText}
                </span>
                <button
                  type="button"
                  data-testid={`provider-row-menu-${profileKey}`}
                  aria-label={t("api.providerRowMenu")}
                  aria-expanded={menuOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenu(menuOpen ? null : profileKey);
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-hover-surface hover:text-foreground"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>

              {menuOpen && (
                <div
                  className="absolute right-2 top-11 z-20 min-w-[132px] rounded-lg border border-border/60 bg-card p-1 shadow-elevated"
                  role="menu"
                >
                  {!isActive && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`provider-row-set-active-${profileKey}`}
                      onClick={() => {
                        setOpenMenu(null);
                        onSetActive(profileKey as ProviderProfileKey);
                      }}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-hover-surface"
                    >
                      {t("api.providerRowSetActive")}
                    </button>
                  )}
                  {oauthId && status?.loggedIn && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="provider-row-disconnect"
                      onClick={() => {
                        setOpenMenu(null);
                        onDisconnect(oauthId);
                      }}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-hover-surface"
                    >
                      {t("api.providerRowDisconnect")}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`provider-row-delete-${profileKey}`}
                    onClick={() => {
                      setOpenMenu(null);
                      onDelete(profileKey as ProviderProfileKey);
                    }}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                  >
                    {t("api.providerRowDelete")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </SettingsCard>

      <Button
        variant="ghost"
        type="button"
        data-testid="provider-list-add"
        onClick={onAdd}
        className="inline-flex h-auto items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("api.addApi")}
      </Button>
    </div>
  );
}
