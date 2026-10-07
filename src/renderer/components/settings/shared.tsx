// Shared types, constants, and components used across settings tab files.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TFunction } from "i18next";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
  MENU_PANEL_PADDED_CLASS,
} from "../menu-styles";
import type { VoiceInstallPhase } from "../../../shared/ipc-types";
import type { ScheduleWeekday } from "../../types";

// ==================== Shared Types ====================

export interface MCPServerConfig {
  id: string;
  name: string;
  type: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  status: "connecting" | "connected" | "needs-auth" | "failed" | "disabled";
  toolCount: number;
}

export interface MCPToolInfo {
  serverId: string;
  name: string;
  description?: string;
}

export interface MCPPreset {
  name: string;
  type: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  requiresEnv?: string[];
  envDescription?: Record<string, string>;
}

export type LocalizedBanner = { key?: string; text?: string };

export type ScheduleFormMode = "once" | "daily" | "weekly" | "legacy-interval";

// ==================== Shared Helpers ====================

export function renderLocalizedBannerMessage(
  banner: LocalizedBanner,
  t: TFunction,
): string {
  return banner.key ? t(banner.key) : banner.text || "";
}

export function getWeekdayOptions(
  t: TFunction,
): Array<{ value: ScheduleWeekday; label: string }> {
  return [
    { value: 1, label: t("schedule.weekdayMonday") },
    { value: 2, label: t("schedule.weekdayTuesday") },
    { value: 3, label: t("schedule.weekdayWednesday") },
    { value: 4, label: t("schedule.weekdayThursday") },
    { value: 5, label: t("schedule.weekdayFriday") },
    { value: 6, label: t("schedule.weekdaySaturday") },
    { value: 0, label: t("schedule.weekdaySunday") },
  ];
}

export function getScheduleModeOptions(
  t: TFunction,
): Array<{ value: ScheduleFormMode; label: string }> {
  return [
    { value: "once", label: t("schedule.modeOnce") },
    { value: "daily", label: t("schedule.modeDaily") },
    { value: "weekly", label: t("schedule.modeWeekly") },
  ];
}

// ==================== Shared UI Component ====================

export function SettingsContentSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 py-5 border-b border-border-muted">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
        {description && (
          <p className="text-xs leading-5 text-text-muted">{description}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ==================== Settings row vocabulary ====================
// 「分组标题 + 卡片 + 一行一设置」。与上面的 SettingsContentSection 分工不同：
// 那个是「标签 + 裸内容」，服务日志、AGENTS.md 编辑器这类查看器页面，两者并存。

export function SettingsSection({
  title,
  description,
  children,
  inlineHint = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /**
   * 把说明挤到标题同一行（标题 + 小一号灰字）。
   * 分类目录用这种：三类各占一行标题会白吃三行高度。默认仍是上下两行。
   */
  inlineHint?: boolean;
}) {
  return (
    <section className="space-y-2">
      {inlineHint ? (
        // 说明不在 h4 里：否则它会并进标题的可访问名，
        // 读屏用户会把「订阅 登录即可，无需密钥」当成一个标题。
        <div className="flex items-baseline gap-2 px-1">
          <h4 className="text-sm font-medium text-text-primary">{title}</h4>
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
      ) : (
        <div className="space-y-0.5 px-1">
          <h4 className="text-sm font-medium text-text-primary">{title}</h4>
          {description && (
            <p className="text-xs leading-5 text-text-muted">{description}</p>
          )}
        </div>
      )}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-container border border-border-muted bg-surface">
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  note,
  control,
  testId,
  sub,
  badge,
  icon,
}: {
  title: string;
  description?: string;
  note?: string;
  control?: React.ReactNode;
  testId?: string;
  /** 子行：属于上面那一行的配置项。只缩进文字列并降级标题，行容器不动。 */
  sub?: boolean;
  /** 标题行内的状态徽标。 */
  badge?: React.ReactNode;
  /** 标题行左侧的品牌图标。 */
  icon?: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-[54px] items-center gap-4 border-t border-border-muted px-4 py-3 first:border-t-0"
    >
      <div className={`min-w-0 flex-1${sub ? " pl-4" : ""}`}>
        <div
          className={
            sub
              ? "text-xs text-text-secondary"
              : "flex items-center gap-2 text-sm font-medium text-text-primary"
          }
        >
          {icon}
          {title}
          {badge}
        </div>
        {description && (
          <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-text-muted">
            {description}
          </div>
        )}
        {/* note 不截断：要用户去做什么的话不能被行高截掉。 */}
        {note && (
          <div className="mt-0.5 text-xs leading-5 text-text-muted">{note}</div>
        )}
      </div>
      {control && (
        <div className="flex flex-none items-center gap-2">{control}</div>
      )}
    </div>
  );
}

export function SettingsSwitch({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-[34px] flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        // 关态轨道用 bg-border，圆点用 bg-background：白圆点压 bg-surface-active 在
        // 亮色系（1.19–1.29）和压浅色 accent 在 6 个暗色预设（1.86–2.72）都看不见。
        // 换成 background 后关态最小 1.47、开态最小 4.53（14 个主题块），且不再硬编码颜色。
        checked ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all ${
          checked ? "left-4" : "left-0.5"
        }`}
      />
    </button>
  );
}

/**
 * 设置项里的下拉。
 *
 * **不用原生 `<select>`**：它的展开菜单由操作系统绘制，跟随**系统**外观而不是 app
 * 主题 —— 浅色主题 + 深色系统会弹出系统深色菜单（选中行是系统高亮色），CSS 够不着；
 * 菜单还会被行容器裁掉。做法照 `usage/CurrencySelect`（那边已经踩过一遍并写在注释里）。
 *
 * 菜单开合与面板样式都用仓库共享的那套（menu-styles + 外点关闭 + Esc），不新造样式。
 */
export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
  disabled = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
  testId?: string;
  /** 未安装时音色不可选：选了也没用，还会让人以为已经生效。 */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const current = options.find((option) => option.value === value);

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-surface-hover disabled:opacity-50"
      >
        <span className="whitespace-nowrap">{current?.label ?? value}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`${MENU_PANEL_PADDED_CLASS} animate-menu-in-down absolute top-[calc(100%_+_6px)] right-0 z-30 min-w-full`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-testid={
                testId ? `${testId}-option-${option.value}` : undefined
              }
              onClick={() => {
                setOpen(false);
                if (option.value !== value) onChange(option.value);
              }}
              className={`${MENU_ITEM_CLASS} ${
                option.value === value
                  ? MENU_ITEM_SELECTED_CLASS
                  : MENU_ITEM_DEFAULT_CLASS
              }`}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Check className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export type StatusBadgeTone = "ok" | "muted" | "busy" | "error";

/** 状态徽标的点色。tone → 语义 token，不硬编码色值。 */
const STATUS_BADGE_DOTS = {
  ok: "bg-success",
  muted: "bg-text-muted",
  busy: "bg-accent",
  error: "bg-error",
} as const;

export function SettingsStatusBadge({
  tone,
  label,
  testId,
  dotOnly = false,
}: {
  tone: StatusBadgeTone;
  label: string;
  testId?: string;
  /**
   * 只渲染一个装饰圆点，label 不使用（调用方要把它并进按钮的 aria-label）。
   * 窄容器（分类网格的 40px 瓦片）容不下一个带字的胶囊，且瓦片的文字列
   * 还要靠剩余宽度，所以在那里用点。
   */
  dotOnly?: boolean;
}) {
  if (dotOnly) {
    // 纯装饰点：button 的子节点在无障碍树里被压平（Children Presentational），
    // 所以这里放 role="status" 或 sr-only 都不会被读出。状态由调用方
    // 并进按钮的 aria-label，那才是读屏真正拿到的东西。
    return (
      <span data-testid={testId} aria-hidden="true" className="flex-none">
        <span
          className={`block h-2 w-2 rounded-full ${STATUS_BADGE_DOTS[tone]}`}
        />
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      // 状态会自己变（未安装 → 下载中 42% → 已安装），所以它是 live region：
      // 否则读屏用户在 140MB 的下载期间听不到任何反馈。
      role="status"
      // flex-none + whitespace-nowrap：这个胶囊一旦落进 flex 行，默认会被压缩，
      // 中文就会一个字一行地竖排并撞穿行高。
      className="ml-2 inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-text-secondary"
    >
      <span
        className={`h-1.5 w-1.5 flex-none rounded-full ${STATUS_BADGE_DOTS[tone]}`}
      />
      {label}
    </span>
  );
}

/** 安装状态的最小形状。语音与朗读两套 state 结构相同，共用一条判定。 */
export interface InstallStateLike {
  /**
   * 阶段名。**故意收成 string**：朗读/语音输入那份与「最佳音质」引擎那份的阶段
   * 词汇不同（引擎有 checking / installing，sherpa 有 extracting），两边共用这一条
   * 徽标规则比维护两套近乎相同的 helper 更不容易分叉。
   */
  phase: VoiceInstallPhase | string;
  percent: number;
  installed: boolean;
}

/**
 * 进行中的阶段。两卡共用，避免一处只写 downloading 而漏掉 extracting。
 * `checking`（引擎预检：磁盘/内存）与 `installing`（引擎解包 + 预热）是
 * 「最佳音质」档那边独有的阶段。
 */
const BUSY_PHASES: readonly string[] = [
  "downloading",
  "extracting",
  "checking",
  "installing",
];

export function isInstalling(state: InstallStateLike | null): boolean {
  return state !== null && BUSY_PHASES.includes(state.phase);
}

/**
 * 安装状态 → 徽标文案与色调。语音输入与朗读共用这一条，
 * 两卡的「未安装 / 下载中 / 已安装 / 下载失败」从此不会各自分叉。
 */
export function installStatusLabel(
  t: TFunction,
  state: InstallStateLike | null,
): { tone: StatusBadgeTone; label: string } {
  if (isInstalling(state)) {
    return {
      tone: "busy",
      label: t("settings.capabilities.install.downloading", {
        percent: state?.percent ?? 0,
      }),
    };
  }
  if (state?.installed === true) {
    return { tone: "ok", label: t("settings.capabilities.install.installed") };
  }
  if (state?.phase === "error") {
    return { tone: "error", label: t("settings.capabilities.install.failed") };
  }
  return {
    tone: "muted",
    label: t("settings.capabilities.install.notInstalled"),
  };
}

/** 安装进度条。不是一行内容，所以直接躺在卡片里，不塞进 SettingsRow 的 control。 */
export function InstallProgress({
  percent,
  testId,
}: {
  percent: number;
  testId?: string;
}) {
  return (
    <div className="px-4 pb-3" data-testid={testId}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
      >
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
