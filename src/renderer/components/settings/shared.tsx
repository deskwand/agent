// Shared types, constants, and components used across settings tab files.

import type { TFunction } from "i18next";
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
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5 px-1">
        <h4 className="text-sm font-medium text-text-primary">{title}</h4>
        {description && (
          <p className="text-xs leading-5 text-text-muted">{description}</p>
        )}
      </div>
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
}: {
  title: string;
  description?: string;
  note?: string;
  control?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-[54px] items-center gap-4 border-t border-border-muted px-4 py-3 first:border-t-0"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">{title}</div>
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

export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="rounded-control border border-border bg-surface px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-surface-hover"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
