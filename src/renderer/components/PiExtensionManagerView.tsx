import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PiExtensionManagerState } from "../../shared/ipc-types";
import type { ServerEvent } from "../types";
import { PiMarketDetail } from "./PiMarketDetail";
import { PiMarketList } from "./PiMarketList";

/**
 * Pi 扩展管理视图：展示兼容 SDK 版本、已安装包与已加载扩展，
 * 支持安装 / 卸载 / 更新（写回与 Pi CLI 相同的 settings.json）。
 */
export function PiExtensionManagerView() {
  const { t } = useTranslation();
  const [state, setState] = useState<PiExtensionManagerState | null>(null);
  const [sourceInput, setSourceInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"market" | "installed">("market");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const refresh = () => {
    window.electronAPI.piExtensions
      .listState()
      .then(setState)
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
  };

  useEffect(() => {
    refresh();
    return window.electronAPI.on((event: ServerEvent) => {
      if (event.type === "pi.package-progress") {
        const p = event.payload as { action?: string; source?: string; message?: string };
        if (p.action === "complete" || p.action === "error") {
          refresh();
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = (await op()) as { success?: boolean; error?: string };
      if (!result.success) {
        setNotice(result.error ?? "failed");
      } else {
        refresh();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const install = () => {
    const source = sourceInput.trim();
    if (!source) return;
    run(() => window.electronAPI.piExtensions.installPackage(source)).then(() => {
      setSourceInput("");
    });
  };

  if (!state) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  const installedNames = normalizeInstalledSources(state.packages);
  const selectedInstalled = selectedName
    ? state.packages.find(
        (pkg) => isInstalled(normalizeInstalledSources([pkg]), selectedName),
      )
    : undefined;

  return (
    <div className="p-6 text-sm">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-base font-semibold">{t("piExtensions.title")}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {t("piExtensions.sdkVersion", { version: state.sdkVersion })}
        </span>
      </div>

      <div className="mb-4 inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
        <button
          type="button"
          className={
            view === "market"
              ? "rounded-md bg-background px-3 py-1 text-sm font-medium shadow-sm"
              : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
          }
          onClick={() => setView("market")}
        >
          {t("piExtensions.viewMarket")}
        </button>
        <button
          type="button"
          className={
            view === "installed"
              ? "rounded-md bg-background px-3 py-1 text-sm font-medium shadow-sm"
              : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
          }
          onClick={() => setView("installed")}
        >
          {t("piExtensions.viewInstalled")}
        </button>
      </div>

      {view === "market" ? (
        <div className="flex items-start gap-4">
          <PiMarketList
            installedNames={installedNames}
            selectedName={selectedName}
            onSelect={(pkg) => setSelectedName(pkg.name)}
          />
          <PiMarketDetail
            name={selectedName ?? ""}
            installed={selectedInstalled !== undefined}
            installedSource={
              selectedInstalled
                ? {
                    source: selectedInstalled.source,
                    scope: selectedInstalled.scope,
                  }
                : undefined
            }
            onInstalledChange={refresh}
          />
        </div>
      ) : (
        <>
          {notice && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
              {notice}
            </div>
          )}

      <div className="mb-6 flex gap-2">
        <input
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2"
          placeholder={t("piExtensions.installPlaceholder")}
          value={sourceInput}
          onChange={(e) => setSourceInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") install();
          }}
        />
        <button
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          disabled={busy || !sourceInput.trim()}
          onClick={install}
        >
          {t("piExtensions.install")}
        </button>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        {t("piExtensions.installWarning")}
      </p>

      <div className="mb-6">
        <h3 className="mb-2 font-medium">{t("piExtensions.packages")}</h3>
        {state.packages.length === 0 ? (
          <p className="text-muted-foreground">{t("piExtensions.noPackages")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {state.packages.map((pkg) => (
              <li
                key={pkg.source}
                className="flex items-center justify-between px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs">{pkg.source}</div>
                  <div className="text-xs text-muted-foreground">
                    {pkg.type} · {pkg.scope}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        window.electronAPI.piExtensions.updatePackage(pkg.source),
                      )
                    }
                  >
                    {t("piExtensions.update")}
                  </button>
                  <button
                    className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        window.electronAPI.piExtensions.removePackage(
                          pkg.source,
                          pkg.scope === "project",
                        ),
                      )
                    }
                  >
                    {t("piExtensions.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-6 rounded-lg border border-border/50 px-3 py-2 text-xs text-muted-foreground">
        {t("piExtensions.unsupportedNote")}
      </div>

      <div>
        <h3 className="mb-2 font-medium">{t("piExtensions.extensions")}</h3>
        {state.extensions.length === 0 ? (
          <p className="text-muted-foreground">
            {t("piExtensions.noExtensions")}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {state.extensions.map((ext) => (
              <li key={ext.path} className="px-3 py-2">
                <div className="truncate font-mono text-xs">{ext.path}</div>
                <div className="text-xs text-muted-foreground">
                  {ext.source} · {ext.scope}
                  {ext.error ? (
                    <span className="ml-2 text-danger">{ext.error}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {state.errors.length > 0 && (
          <ul className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {state.errors.map((err) => (
              <li key={err.path}>
                <span className="font-mono">{err.path}</span>: {err.error}
              </li>
            ))}
          </ul>
        )}
      </div>
        </>
      )}
    </div>
  );
}

/**
 * 归一化已安装包的 source 为市场包名：
 * - `npm:` 前缀与尾部版本段去除：`npm:pi-x@^1.0` → `pi-x`，`npm:@scope/pkg@2.0.0` → `@scope/pkg`（保留 scope 斜杠）
 * - `git:` 前缀去除并取最后一个路径段：`git:github.com/user/repo@v1` → `repo`
 * - 本地路径取最后一个路径段：`/tmp/local-ext` → `local-ext`
 */
export function normalizeInstalledSources(
  packages: Array<{ source: string; scope: string }>,
): string[] {
  return packages.map((pkg) => {
    let name = pkg.source;
    if (name.startsWith("npm:")) {
      return stripVersionSegment(name.slice("npm:".length));
    }
    if (name.startsWith("git:")) {
      name = name.slice("git:".length).replace(/^.*\//, "");
      return stripVersionSegment(name);
    }
    return name.replace(/\/+$/, "").split("/").pop() ?? name;
  });
}

/** 去掉包名尾部的版本段，保留 scoped 包的 scope 斜杠。 */
function stripVersionSegment(name: string): string {
  const at = name.lastIndexOf("@");
  if (at <= 0) return name;
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash > 0 && at > slash) return name.slice(0, at);
    return name;
  }
  return name.slice(0, at);
}

/** 判断归一化后的包名是否已安装（精确匹配）。 */
export function isInstalled(installed: string[], name: string): boolean {
  return installed.includes(name);
}
