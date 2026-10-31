import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProviderPresets, ProviderProfileKey } from "../../../types";
import { Button } from "../../app-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
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
                {/* 菜单走 Radix 的 portal 版（DropdownMenuContent 自带 Portal）：
                    行内 absolute 弹层会被外层 SettingsCard 的 overflow-hidden 裁掉，
                    列表最后一行的菜单只露出上半截。改回行内 div 前先确认这一点。 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid={`provider-row-menu-${profileKey}`}
                      aria-label={t("api.providerRowMenu")}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-hover-surface hover:text-foreground data-[state=open]:bg-hover-surface"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={6}
                    className="min-w-[132px] border-border/60 bg-card shadow-elevated"
                  >
                    <DropdownMenuItem
                      data-testid={`provider-row-edit-${profileKey}`}
                      onSelect={() => onOpen(profileKey as ProviderProfileKey)}
                      className="px-2.5 py-1.5 text-xs text-foreground focus:bg-hover-surface"
                    >
                      {t("api.editApi")}
                    </DropdownMenuItem>
                    {!isActive && (
                      <DropdownMenuItem
                        data-testid={`provider-row-set-active-${profileKey}`}
                        onSelect={() =>
                          onSetActive(profileKey as ProviderProfileKey)
                        }
                        className="px-2.5 py-1.5 text-xs text-foreground focus:bg-hover-surface"
                      >
                        {t("api.providerRowSetActive")}
                      </DropdownMenuItem>
                    )}
                    {oauthId && status?.loggedIn && (
                      <DropdownMenuItem
                        data-testid="provider-row-disconnect"
                        onSelect={() => onDisconnect(oauthId)}
                        className="px-2.5 py-1.5 text-xs text-foreground focus:bg-hover-surface"
                      >
                        {t("api.providerRowDisconnect")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      data-testid={`provider-row-delete-${profileKey}`}
                      onSelect={() =>
                        onDelete(profileKey as ProviderProfileKey)
                      }
                      className="px-2.5 py-1.5 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      {t("api.providerRowDelete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
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
