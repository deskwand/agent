import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle,
  Package,
  Plus,
  Loader2,
  Search,
  X,
} from "lucide-react";
import type {
  PluginCatalogItemV2,
  InstalledPlugin,
  PluginComponentKind,
} from "../../types";
import type { LocalizedBanner } from "./shared";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

export function SettingsPlugins({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [plugins, setPlugins] = useState<PluginCatalogItemV2[]>([]);
  const [installedPluginsByKey, setInstalledPluginsByKey] = useState<
    Record<string, InstalledPlugin>
  >({});
  const [isPluginLoading, setIsPluginLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [pluginActionKey, setPluginActionKey] = useState<string | null>(null);
  const [pluginToastMessage, setPluginToastMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const currentPageRef = useRef(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const pluginToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const componentOrder: PluginComponentKind[] = [
    "skills",
    "commands",
    "agents",
    "extensions",
    "hooks",
    "mcp",
  ];

  function normalizePluginLookupKey(value: string | undefined): string {
    if (!value) return "";
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getCatalogLookupKeys(plugin: PluginCatalogItemV2): string[] {
    const keys = new Set<string>();
    const addKey = (value: string | undefined) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      keys.add(trimmed);
      keys.add(trimmed.toLowerCase());
      const normalized = normalizePluginLookupKey(trimmed);
      if (normalized) keys.add(normalized);
    };
    addKey(plugin.name);
    addKey(plugin.pluginId);
    const marketplaceId = plugin.pluginId?.split("@")[0];
    addKey(marketplaceId);
    return [...keys];
  }

  function showPluginInstallToast(message: string) {
    setPluginToastMessage(message);
    if (pluginToastTimerRef.current) {
      clearTimeout(pluginToastTimerRef.current);
    }
    pluginToastTimerRef.current = setTimeout(() => {
      setPluginToastMessage("");
      pluginToastTimerRef.current = null;
    }, 5000);
  }

  const PI_PAGE_SIZE = 50;

  const loadPlugins = useCallback(async (page = 1) => {
    const isInitialLoad = page === 1;
    if (isInitialLoad) currentPageRef.current = 1;
    try {
      setIsPluginLoading(true);
      const [catalog, installed] = await Promise.all([
        window.electronAPI.plugins.listCatalog({
          installableOnly: false,
          page,
        }),
        isInitialLoad
          ? window.electronAPI.plugins.listInstalled()
          : Promise.resolve(null),
      ]);
      const newItems = catalog || [];
      setPlugins((prev) => (isInitialLoad ? newItems : [...prev, ...newItems]));
      setHasMore(newItems.length >= PI_PAGE_SIZE);
      if (isInitialLoad && installed) {
        const nextInstalledByKey: Record<string, InstalledPlugin> = {};
        const addLookupKey = (key: string, plugin: InstalledPlugin) => {
          if (!key || nextInstalledByKey[key]) return;
          nextInstalledByKey[key] = plugin;
        };
        for (const plugin of installed || []) {
          const candidates = [
            plugin.name,
            plugin.name?.toLowerCase(),
            normalizePluginLookupKey(plugin.name),
            plugin.pluginId,
            plugin.pluginId?.toLowerCase(),
            normalizePluginLookupKey(plugin.pluginId),
          ].filter((value): value is string => Boolean(value));
          for (const key of candidates) {
            addLookupKey(key, plugin);
          }
        }
        setInstalledPluginsByKey(nextInstalledByKey);
      }
      setError(null);
    } catch (err) {
      setError({
        text:
          err instanceof Error
            ? err.message
            : tRef.current("skills.pluginInstallFailed"),
      });
    } finally {
      setIsPluginLoading(false);
      setHasLoaded(true);
    }
  }, []);

  // Auto-load on first activation
  useEffect(() => {
    if (!isElectron || !isActive || hasLoaded) return;
    void loadPlugins();
    return () => {
      if (pluginToastTimerRef.current) {
        clearTimeout(pluginToastTimerRef.current);
      }
    };
  }, [isActive, hasLoaded, loadPlugins]);

  async function loadMore() {
    currentPageRef.current += 1;
    await loadPlugins(currentPageRef.current);
  }

  async function handleInstallPlugin(plugin: PluginCatalogItemV2) {
    const installTarget = plugin.pluginId ?? plugin.name;
    setPluginActionKey(`install:${installTarget}`);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.electronAPI.plugins.install(installTarget);
      await loadPlugins();
      const message = tRef.current("skills.pluginInstallSuccess", {
        name: result.plugin.name,
      });
      setSuccess({ text: message });
      showPluginInstallToast(message);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError({
        text:
          err instanceof Error
            ? err.message
            : tRef.current("skills.pluginInstallFailed"),
      });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetPluginEnabled(
    plugin: InstalledPlugin,
    enabled: boolean,
  ) {
    setPluginActionKey(`enabled:${plugin.pluginId}`);
    setError(null);
    try {
      await window.electronAPI.plugins.setEnabled(plugin.pluginId, enabled);
      await loadPlugins();
    } catch (err) {
      setError({
        text:
          err instanceof Error
            ? err.message
            : tRef.current("skills.pluginInstallFailed"),
      });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetComponentEnabled(
    plugin: InstalledPlugin,
    component: PluginComponentKind,
    enabled: boolean,
  ) {
    setPluginActionKey(`component:${plugin.pluginId}:${component}`);
    setError(null);
    try {
      await window.electronAPI.plugins.setComponentEnabled(
        plugin.pluginId,
        component,
        enabled,
      );
      await loadPlugins();
    } catch (err) {
      setError({
        text:
          err instanceof Error
            ? err.message
            : tRef.current("skills.pluginInstallFailed"),
      });
    } finally {
      setPluginActionKey(null);
    }
  }

  const [uninstallConfirm, setUninstallConfirm] =
    useState<InstalledPlugin | null>(null);

  async function handleUninstallPlugin(plugin: InstalledPlugin) {
    setUninstallConfirm(plugin);
  }

  async function executeUninstall(plugin: InstalledPlugin) {
    setUninstallConfirm(null);
    setPluginActionKey(`uninstall:${plugin.pluginId}`);
    setError(null);
    try {
      await window.electronAPI.plugins.uninstall(plugin.pluginId);
      await loadPlugins();
      showPluginInstallToast(
        tRef.current("skills.pluginUninstalled", { name: plugin.name }),
      );
    } catch (err) {
      setError({
        text:
          err instanceof Error
            ? err.message
            : tRef.current("skills.pluginInstallFailed"),
      });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleImportFromFolder() {
    try {
      const folderPath = await window.electronAPI.invoke<string | null>({
        type: "folder.select",
        payload: {},
      });
      if (!folderPath) return;

      setIsImporting(true);
      const validation = await window.electronAPI.skills.validate(folderPath);

      if (!validation.valid) {
        setError({
          text: `Invalid skill folder: ${validation.errors.join(", ")}`,
        });
        return;
      }

      const result = await window.electronAPI.skills.install(folderPath);
      if (result.success) {
        setError(null);
        setSuccess(null);
        showPluginInstallToast(
          tRef.current("skills.installSkillSuccess", {
            name: folderPath.split("/").pop() || folderPath,
          }),
        );
      }
    } catch (err) {
      setError({
        text:
          err instanceof Error
            ? err.message
            : tRef.current("skills.failedToInstall"),
      });
    } finally {
      setIsImporting(false);
    }
  }

  const filteredPlugins = plugins.filter((plugin) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      plugin.name?.toLowerCase().includes(q) ||
      plugin.description?.toLowerCase().includes(q) ||
      plugin.pluginId?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error.key ? t(error.key) : error.text}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4" />
          {success.key ? t(success.key) : success.text}
        </div>
      )}

      {/* Search + Import bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("plugins.searchPlaceholder")}
            className="w-full pl-9 pr-8 py-2.5 rounded-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-secondary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={handleImportFromFolder}
          disabled={isImporting}
          className="flex-shrink-0 py-2.5 px-4 rounded-lg border-2 border-dashed border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex items-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50 text-sm"
        >
          {isImporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          {t("plugins.importFromFolder")}
        </button>
      </div>

      {/* Plugin grid */}
      {isPluginLoading && !hasLoaded ? (
        <div className="py-12 flex items-center justify-center gap-2 text-text-secondary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>{t("common.loading")}</span>
        </div>
      ) : filteredPlugins.length === 0 ? (
        <div className="py-12 text-center">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-50 text-text-muted" />
          <p className="text-text-muted">
            {searchQuery ? t("plugins.noResults") : t("skills.noPluginsFound")}
          </p>
          {searchQuery && hasMore && (
            <p className="text-xs text-text-muted mt-2">
              {t("plugins.tryLoadMore")}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredPlugins.map((plugin) => {
            const installedPlugin = getCatalogLookupKeys(plugin)
              .map((key) => installedPluginsByKey[key])
              .find((item): item is InstalledPlugin => Boolean(item));
            const installTarget = plugin.pluginId ?? plugin.name;
            const isInstalling = pluginActionKey === `install:${installTarget}`;
            const componentEntries = componentOrder.filter(
              (component) => plugin.componentCounts[component] > 0,
            );
            const hasKnownComponents = componentEntries.length > 0;
            const isInstallable = plugin.installable;
            const isPiAgent = plugin.catalogSource === "pi-agent";

            return (
              <div
                key={plugin.pluginId || plugin.name}
                className="rounded-lg border border-border bg-surface-hover p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-text-primary truncate">
                        {plugin.name}
                      </h4>
                      {plugin.version && (
                        <span className="text-xs px-2 py-0.5 rounded bg-surface text-text-muted">
                          v{plugin.version}
                        </span>
                      )}
                      {isPiAgent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">
                          pi
                        </span>
                      )}
                    </div>
                    {plugin.description && (
                      <p className="text-sm text-text-muted line-clamp-2">
                        {plugin.description}
                      </p>
                    )}
                    {/* pi metadata row */}
                    {isPiAgent && (
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-muted">
                        {plugin.downloadCount != null &&
                          plugin.downloadCount > 0 && (
                            <span>
                              ↓ {plugin.downloadCount.toLocaleString()}
                            </span>
                          )}
                        {plugin.license && <span>{plugin.license}</span>}
                        {plugin.packageType && (
                          <span className="capitalize">
                            {plugin.packageType}
                          </span>
                        )}
                      </div>
                    )}
                    {hasKnownComponents ? (
                      <p className="text-xs text-text-muted mt-2">
                        {t("skills.pluginComponents", {
                          skills: plugin.componentCounts.skills,
                          commands: plugin.componentCounts.commands,
                          agents: plugin.componentCounts.agents,
                          extensions: plugin.componentCounts.extensions,
                          hooks: plugin.componentCounts.hooks,
                          mcp: plugin.componentCounts.mcp,
                        })}
                      </p>
                    ) : (
                      !installedPlugin && (
                        <p className="text-xs text-text-muted mt-2">
                          {t("skills.pluginComponentsAvailableAfterInstall")}
                        </p>
                      )
                    )}
                    {hasKnownComponents &&
                      plugin.componentCounts.hooks > 0 &&
                      !installedPlugin && (
                        <p className="text-xs text-warning mt-1">
                          {t("skills.pluginComponentHooksDisabledByDefault")}
                        </p>
                      )}
                    {hasKnownComponents &&
                      plugin.componentCounts.mcp > 0 &&
                      !installedPlugin && (
                        <p className="text-xs text-warning mt-1">
                          {t("skills.pluginComponentMcpDisabledByDefault")}
                        </p>
                      )}
                    {!isInstallable && !hasKnownComponents && (
                      <p className="text-xs text-error mt-1">
                        {t("skills.pluginNoComponents")}
                      </p>
                    )}
                  </div>
                  {installedPlugin ? (
                    <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-success/10 text-success text-sm flex-shrink-0">
                      <CheckCircle className="w-4 h-4" />
                      {t("skills.pluginInstalled")}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleInstallPlugin(plugin)}
                      disabled={!isInstallable || pluginActionKey !== null}
                      className="px-3 py-2 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm flex-shrink-0"
                    >
                      {isInstalling ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t("common.install")}
                        </span>
                      ) : (
                        t("skills.pluginInstall")
                      )}
                    </button>
                  )}
                </div>
                {installedPlugin && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-text-muted">
                        {installedPlugin.enabled
                          ? t("skills.pluginAppliedInRuntime")
                          : t("skills.pluginDisabled")}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            handleSetPluginEnabled(
                              installedPlugin,
                              !installedPlugin.enabled,
                            )
                          }
                          disabled={pluginActionKey !== null}
                          className={`px-3 py-1.5 rounded-md text-xs ${
                            installedPlugin.enabled
                              ? "bg-warning/10 text-warning hover:bg-warning/20"
                              : "bg-success/10 text-success hover:bg-success/20"
                          } disabled:opacity-50`}
                        >
                          {installedPlugin.enabled
                            ? t("skills.pluginDisable")
                            : t("skills.pluginEnable")}
                        </button>
                        <button
                          onClick={() => handleUninstallPlugin(installedPlugin)}
                          disabled={pluginActionKey !== null}
                          className="px-3 py-1.5 rounded-md text-xs bg-error/10 text-error hover:bg-error/20 disabled:opacity-50"
                        >
                          {t("skills.pluginManageUninstall")}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {componentEntries.map((component) => {
                        const enabled =
                          installedPlugin.componentsEnabled[component];
                        return (
                          <div
                            key={`${installedPlugin.pluginId}:${component}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <div className="text-xs text-text-secondary">
                              <span className="font-medium">{component}</span>
                              <span className="text-text-muted">
                                {" "}
                                ({plugin.componentCounts[component]})
                              </span>
                            </div>
                            <button
                              onClick={() =>
                                handleSetComponentEnabled(
                                  installedPlugin,
                                  component,
                                  !enabled,
                                )
                              }
                              disabled={pluginActionKey !== null}
                              className={`px-2 py-1 rounded text-xs ${
                                enabled
                                  ? "bg-success/10 text-success hover:bg-success/20"
                                  : "bg-surface text-text-muted hover:bg-surface-active"
                              } disabled:opacity-50`}
                            >
                              {enabled
                                ? t("skills.pluginDisable")
                                : t("skills.pluginEnable")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isPluginLoading &&
        filteredPlugins.length > 0 &&
        hasMore &&
        !searchQuery.trim() && (
          <div className="flex justify-center pt-2 pb-4">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={isPluginLoading}
              className="px-6 py-2.5 text-sm font-medium rounded-xl border border-border bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isPluginLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t("common.loading")}
                </>
              ) : (
                t("plugins.loadMore")
              )}
            </button>
          </div>
        )}

      {uninstallConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setUninstallConfirm(null)}
          />

          {/* Modal */}
          <div className="relative w-full max-w-sm bg-surface rounded-xl shadow-xl border border-border mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
              <h3 className="text-sm font-semibold text-text-primary">
                {t("plugins.uninstallTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setUninstallConfirm(null)}
                className="p-1 rounded-md hover:bg-surface-hover text-text-muted transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-6 text-center space-y-2">
              <p className="text-sm text-text-primary">
                {t("skills.pluginUninstall", {
                  name: uninstallConfirm.name,
                })}
              </p>
              <p className="text-xs text-text-muted">
                {t("plugins.uninstallDesc")}
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-muted">
              <button
                type="button"
                onClick={() => setUninstallConfirm(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => executeUninstall(uninstallConfirm)}
                disabled={pluginActionKey !== null}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-error text-white hover:bg-error/90 disabled:opacity-50 transition-colors"
              >
                {t("plugins.uninstallConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pluginToastMessage && (
        <div className="fixed right-6 bottom-6 z-[80] max-w-md rounded-2xl border border-success/30 bg-surface px-4 py-3 shadow-elevated">
          <div className="flex items-start gap-2 text-success text-sm">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{pluginToastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
