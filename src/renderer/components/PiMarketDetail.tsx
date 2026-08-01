import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PiMarketDetailDto } from "../../shared/ipc-types";
import { useAppStore } from "../store";

export interface PiMarketDetailProps {
  name: string;
  installed: boolean;
  installedSource?: { source: string; scope: "user" | "project" };
  onInstalledChange: () => void;
}

/** 确定性哈希 → 十六进制颜色，用作占位图标的背景色。 */
export function hashColor(name: string): string {
  const hash = name
    .split("")
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7);
  // 压缩到深色范围（各通道 ≤ 0x66），保证白色首字母可读
  const r = ((hash >>> 16) & 0xff) % 0x66;
  const g = ((hash >>> 8) & 0xff) % 0x66;
  const b = (hash & 0xff) % 0x66;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 取包名首字母大写；scoped 包（@scope/name）取 scope 之后的首字母。 */
function initialOf(name: string): string {
  const segment =
    name.startsWith("@") && name.includes("/")
      ? name.slice(name.indexOf("/") + 1)
      : name;
  return (segment.charAt(0) || "?").toUpperCase();
}

const LINK_BUTTON_CLASS =
  "rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary hover:bg-surface-hover";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BUTTON_CLASS =
  "rounded-md border border-error/40 px-3 py-1.5 text-sm text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50";

/** Pi 扩展市场右栏详情：gallery 预览降级为首字母占位图标 + 安装/更新/卸载。 */
export function PiMarketDetail({
  name,
  installed,
  installedSource,
  onInstalledChange,
}: PiMarketDetailProps) {
  const { t } = useTranslation();
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  const [detail, setDetail] = useState<PiMarketDetailDto | null>(null);
  const [downloads, setDownloads] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!name) {
      requestSeqRef.current += 1;
      setDetail(null);
      setDownloads(null);
      setLoading(false);
      setError(null);
      setFailed(false);
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    setFailed(false);
    setDetail(null);
    setDownloads(null);

    window.electronAPI.piMarket
      .detail(name)
      .then((result) => {
        if (requestSeqRef.current === seq) setDetail(result);
      })
      .catch((reason: unknown) => {
        if (requestSeqRef.current === seq) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setFailed(true);
        }
      })
      .finally(() => {
        if (requestSeqRef.current === seq) setLoading(false);
      });

    window.electronAPI.piMarket
      .download(name)
      .then((count) => {
        if (requestSeqRef.current === seq) setDownloads(count);
      })
      .catch(() => {
        if (requestSeqRef.current === seq) setDownloads(null);
      });

    return () => {
      requestSeqRef.current += 1;
    };
  }, [name, reloadKey]);

  const showActionError = (result: { success: boolean; error?: string }) => {
    setGlobalNotice({
      id: `pi-market-action-${Date.now()}`,
      type: "error",
      message: result.error ?? t("piExtensions.marketActionFailed"),
    });
  };

  const runAction = async (
    op: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    setBusy(true);
    try {
      const result = await op();
      if (result.success) {
        onInstalledChange();
      } else {
        showActionError(result);
      }
    } catch (reason: unknown) {
      setGlobalNotice({
        id: `pi-market-action-${Date.now()}`,
        type: "error",
        message:
          reason instanceof Error
            ? reason.message
            : t("piExtensions.marketActionFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = () =>
    runAction(() =>
      window.electronAPI.piExtensions.installPackage(`npm:${name}`),
    );

  const handleUpdate = () => {
    if (installedSource) {
      runAction(() =>
        window.electronAPI.piExtensions.updatePackage(installedSource.source),
      );
    }
  };

  const handleRemove = () => {
    if (installedSource) {
      runAction(() =>
        window.electronAPI.piExtensions.removePackage(
          installedSource.source,
          installedSource.scope === "project",
        ),
      );
    }
  };

  const openLink = (url: string) => {
    // npm repository.url 常用 git+https:// / git+ssh://，shell.openExternal 拒绝非 http(s)
    let normalized = url;
    if (url.startsWith("git+https://")) normalized = url.slice(4);
    else if (url.startsWith("git+ssh://")) {
      normalized = "https://" + url.slice(9); // git+ssh://git@host/path → https://git@host/path
    } else if (url.startsWith("git://")) normalized = "https://" + url.slice(6);
    else if (url.startsWith("ssh://")) normalized = "https://" + url.slice(6);
    window.electronAPI.openExternal(normalized).catch(() => {});
  };

  const repository = detail?.repository;
  const homepage = detail?.homepage;
  const empty = !name || (detail === null && !loading && !failed);
  const gallery = detail?.gallery;
  const [galleryError, setGalleryError] = useState(false);
  // 选中变化时重置 gallery 错误态
  useEffect(() => {
    setGalleryError(false);
  }, [name, reloadKey]);
  const metaParts = [
    detail?.author,
    detail ? `v${detail.version}` : null,
    detail?.type,
  ].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );

  return (
    <div className="flex h-[480px] w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background-secondary/60">
      {/* 顶部预览区：固定高度，避免状态切换时布局跳动 */}
      <div className="h-[120px] w-full shrink-0 overflow-hidden bg-surface">
        {!name ? null : galleryError ? (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ backgroundColor: hashColor(name) }}
          >
            <span className="text-5xl font-semibold text-white">
              {initialOf(name)}
            </span>
          </div>
        ) : gallery?.image ? (
          <img
            src={gallery.image}
            alt={name}
            className="h-full w-full object-cover"
            onError={() => setGalleryError(true)}
          />
        ) : gallery?.video ? (
          <video
            src={gallery.video}
            controls
            className="h-full w-full bg-background object-contain"
            onError={() => setGalleryError(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ backgroundColor: hashColor(name) }}
          >
            <span className="text-5xl font-semibold text-white">
              {initialOf(name)}
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
            <p className="text-sm text-text-secondary">
              {t("piExtensions.marketDetailFailed")}
            </p>
            {error && <p className="max-w-full break-all text-xs text-text-muted">{error}</p>}
            <button
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background-secondary/60"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              {t("piExtensions.marketRetry")}
            </button>
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
            <p className="text-sm text-text-secondary">
              {t("piExtensions.marketSelectHint")}
            </p>
            {error && <p className="text-xs text-text-muted">{error}</p>}
            <p className="text-xs text-text-muted">
              {t("piExtensions.installWarning")}
            </p>
          </div>
        ) : detail === null ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            {t("common.loading")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="truncate text-base font-semibold text-text-primary">
                {detail.name}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">
                {metaParts.length > 0 ? metaParts.join(" · ") : "\u00a0"}
              </div>
            </div>

            {detail.description && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-text-secondary">
                {detail.description}
              </p>
            )}

            <div className="text-xs text-text-secondary">
              {downloads !== null
                ? t("piExtensions.marketDownloads", { count: downloads })
                : "—"}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={LINK_BUTTON_CLASS}
                onClick={() => openLink(`https://www.npmjs.com/package/${name}`)}
              >
                {t("piExtensions.marketNpm")}
              </button>
              {repository && (
                <button
                  type="button"
                  className={LINK_BUTTON_CLASS}
                  onClick={() => openLink(repository)}
                >
                  {t("piExtensions.marketRepository")}
                </button>
              )}
              {homepage && (
                <button
                  type="button"
                  className={LINK_BUTTON_CLASS}
                  onClick={() => openLink(homepage)}
                >
                  {t("piExtensions.marketHomepage")}
                </button>
              )}
            </div>

            <div className="flex gap-2">
              {installed ? (
                <>
                  <button
                    type="button"
                    className={PRIMARY_BUTTON_CLASS}
                    disabled={busy}
                    onClick={handleUpdate}
                  >
                    {t("piExtensions.update")}
                  </button>
                  <button
                    type="button"
                    className={DANGER_BUTTON_CLASS}
                    disabled={busy}
                    onClick={handleRemove}
                  >
                    {t("piExtensions.remove")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={PRIMARY_BUTTON_CLASS}
                  disabled={busy}
                  onClick={handleInstall}
                >
                  {t("piExtensions.install")}
                </button>
              )}
            </div>

            <p className="text-xs text-text-muted">
              {t("piExtensions.installWarning")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
