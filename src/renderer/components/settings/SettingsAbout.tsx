import { useState, useEffect, useCallback, useId } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, AlertCircle, CheckCircle2, Download } from "lucide-react";
import type { ServerEvent } from "../../types";
import { SettingsCard, SettingsRow, SettingsSection } from "./shared";
import { AppProgress } from "../app-progress";
import appIconUrl from "../../../../resources/icon.png";
import { Button } from "../app-button";
import { useAppStore, type ActiveView } from "../../store";

interface SettingsAboutProps {
  appVersion: string;
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export function SettingsAbout({ appVersion }: SettingsAboutProps) {
  const { t } = useTranslation();

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  /** 进度条的无障碍名指向品牌头里那条可见的「下载中 n%」文案。 */
  const downloadStatusId = useId();

  const handleServerEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "update.available":
        setUpdateStatus("available");
        setUpdateVersion(event.payload.version);
        break;
      case "update.progress":
        setUpdateStatus("downloading");
        setUpdateProgress(Math.round(event.payload.percent));
        break;
      case "update.downloaded":
        setUpdateStatus("downloaded");
        setUpdateVersion(event.payload.version);
        break;
      case "update.not-available":
        setUpdateStatus("up-to-date");
        break;
      case "update.error":
        setUpdateStatus("error");
        setUpdateError(event.payload.message);
        break;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.on(handleServerEvent);
    return () => {
      unsubscribe?.();
    };
  }, [handleServerEvent]);

  const handleCheckUpdate = () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    window.electronAPI?.send({ type: "update.check", payload: {} });
  };

  const handleRestart = () => {
    window.electronAPI?.send({ type: "update.install", payload: {} });
  };

  const statusBadge = () => {
    switch (updateStatus) {
      case "checking":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {t("about.checking")}
          </span>
        );
      case "up-to-date":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="w-3 h-3" />
            {t("about.upToDate")}
          </span>
        );
      case "available":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-primary-text">
            <Download className="w-3 h-3" />
            {t("about.newVersionAvailable", { version: updateVersion })}
          </span>
        );
      case "downloading":
        return (
          <span
            id={downloadStatusId}
            className="inline-flex items-center gap-1 text-xs text-primary-text"
          >
            <Download className="w-3 h-3 animate-pulse" />
            {t("about.downloading", { percent: updateProgress })}
          </span>
        );
      case "downloaded":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="w-3 h-3" />
            {t("about.readyToInstall")}
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="w-3 h-3" />
            {t("about.updateFailed")}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* 品牌头：左对齐一行，按钮在右端 */}
      <div>
        <div className="flex items-center gap-4">
          <img
            src={appIconUrl}
            alt="DeskWand"
            className="h-16 w-16 flex-none"
          />

          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold tracking-tight text-foreground select-none">
              DeskWand
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-muted font-mono text-xs text-muted-foreground">
                v{appVersion || "—"}
              </span>
              {statusBadge()}
            </div>
          </div>

          <div className="flex flex-none items-center gap-2">
            {updateStatus === "idle" && (
              <Button
                variant="ghost"
                onClick={handleCheckUpdate}
                className="inline-flex items-center gap-2 text-xs px-4 py-2 rounded-lg
                  bg-card text-muted-foreground hover:bg-hover-surface
                  ring-1 ring-border-subtle hover:ring-border-muted
                  transition-all duration-150 h-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t("about.checkUpdate")}
              </Button>
            )}

            {(updateStatus === "up-to-date" || updateStatus === "error") && (
              <Button
                variant="ghost"
                onClick={handleCheckUpdate}
                className="inline-flex items-center gap-2 text-xs px-4 py-2 rounded-lg
                  bg-card text-muted-foreground hover:bg-hover-surface
                  ring-1 ring-border-subtle hover:ring-border-muted
                  transition-all duration-150 h-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t("about.checkAgain")}
              </Button>
            )}

            {updateStatus === "downloaded" && (
              <Button
                variant="ghost"
                onClick={handleRestart}
                className="inline-flex items-center gap-2 text-xs px-5 py-2 rounded-lg
                  bg-primary text-primary-foreground hover:bg-primary/90
                  shadow-sm transition-all duration-150 h-auto"
              >
                {t("about.restartNow")}
              </Button>
            )}
          </div>
        </div>

        {/* 状态详情槽：进度条与错误详情互斥，共用同一位置 */}
        {updateStatus === "downloading" && (
          <AppProgress
            value={updateProgress}
            max={100}
            aria-labelledby={downloadStatusId}
            className="mt-3 h-1 bg-muted [&>div]:rounded-full [&>div]:duration-300"
          />
        )}

        {updateStatus === "error" && updateError && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {updateError}
          </p>
        )}
      </div>

      {/* 产品介绍：一段定位 + 6 条核心能力 */}
      <SettingsSection title={t("about.title")}>
        <p className="px-1 text-sm leading-6 text-muted-foreground">
          {t("about.intro")}
        </p>
        <SettingsCard>
          {ABOUT_FEATURES.map((feature) => (
            <SettingsRow
              key={feature.titleKey}
              title={t(feature.titleKey)}
              description={t(feature.descKey)}
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      {/* 外链：走 preload 的 openExternal，不新增 IPC。间隔交给 gap-x-4，
          不插分隔符 —— 4 个装饰字符不值一个 Fragment 导入 + index 条件。 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {ABOUT_LINKS.map((link) => (
          <Button
            variant="ghost"
            key={link.labelKey}
            type="button"
            onClick={() => {
              if (link.view) {
                useAppStore.getState().setActiveView(link.view);
              } else if (link.url) {
                void window.electronAPI?.openExternal(link.url);
              }
            }}
            className="border-b border-border/60 pb-px text-xs text-muted-foreground transition-colors hover:text-foreground h-auto px-0"
          >
            {t(link.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}

// 产品介绍与链接的静态清单。只服务本文件的两个 map，不对外导出 ——
// 测试从渲染结果断言（见 settings-about-page.test.tsx）。
const ABOUT_FEATURES = [
  {
    titleKey: "about.features.goalDriven",
    descKey: "about.features.goalDrivenDesc",
  },
  {
    titleKey: "about.features.subagents",
    descKey: "about.features.subagentsDesc",
  },
  {
    titleKey: "about.features.desktopNative",
    descKey: "about.features.desktopNativeDesc",
  },
  {
    titleKey: "about.features.officeNative",
    descKey: "about.features.officeNativeDesc",
  },
  {
    titleKey: "about.features.selfImprovingSkills",
    descKey: "about.features.selfImprovingSkillsDesc",
  },
  {
    titleKey: "about.features.multiModel",
    descKey: "about.features.multiModelDesc",
  },
];

const ABOUT_LINKS: Array<{
  labelKey: string;
  url?: string;
  view?: ActiveView;
}> = [
  { labelKey: "about.links.website", url: "https://deskwand.com" },
  { labelKey: "about.links.source", url: "https://github.com/deskwand/agent" },
  {
    labelKey: "about.links.releases",
    url: "https://github.com/deskwand/agent/releases",
  },
  {
    labelKey: "about.links.license",
    url: "https://github.com/deskwand/agent/blob/main/LICENSE",
  },
  // 2026-10-06：图标栏那颗「?」在有更新时会让位给升级按钮，帮助菜单在那段时间里
  // 点不开（见 design-docs/2026-10-06-rail-update-icon-design.md §5）。
  // 手册与反馈必须在这页还有入口，否则一段待重启的窗口期内无处可点。
  // 文案直接复用 help.*，与弹出菜单里那两条同名——它们是同一个目的地。
  { labelKey: "help.docs", url: "https://www.deskwand.com/manual" },
  {
    labelKey: "help.feedback",
    view: "feedback",
  },
];
