// Shared types, constants, and components used across settings tab files.

import { useCallback, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TFunction } from "i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { VoiceInstallPhase } from "../../../shared/ipc-types";
import type { ScheduleWeekday } from "../../types";
import { Switch } from "../ui/switch";
import { Button } from "../app-button";

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
    <section className="space-y-3 py-5 border-b border-border/60">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {description && (
          <p className="text-xs leading-5 text-muted-foreground">
            {description}
          </p>
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
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          {description && (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </div>
      ) : (
        <div className="space-y-0.5 px-1">
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          {description && (
            <p className="text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-container border border-border/60 bg-card">
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
      className="flex min-h-[54px] items-center gap-4 border-t border-border/60 px-4 py-3 first:border-t-0"
    >
      <div className={`min-w-0 flex-1${sub ? " pl-4" : ""}`}>
        <div
          className={
            sub
              ? "text-xs text-muted-foreground"
              : "flex items-center gap-2 text-sm font-medium text-foreground"
          }
        >
          {icon}
          {title}
          {badge}
        </div>
        {description && (
          <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {description}
          </div>
        )}
        {/* note 不截断：要用户去做什么的话不能被行高截掉。 */}
        {note && (
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {note}
          </div>
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
    // vendored Switch（Radix）。轨道/圆点取色与原来的手搓实现同值 —— 关态轨道用
    // bg-border、圆点用 bg-background：白圆点压 bg-accent 在亮色系（1.19–1.29）
    // 和压浅色 accent 在 6 个暗色预设（1.86–2.72）都看不见。换成 background 后关态最小
    // 1.47、开态最小 4.53（14 个主题块），且不再硬编码颜色。
    // 这两个 token 正好是 vendored Switch 的默认值（--input、
    // --primary 在官方词汇表里就是强调色），所以 className 不需要覆盖颜色。
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      className="flex-none"
    />
  );
}

/**
 * 设置项里的下拉。
 *
 * **不用原生 `<select>`**：它的展开菜单由操作系统绘制，跟随**系统**外观而不是 app
 * 主题 —— 浅色主题 + 深色系统会弹出系统深色菜单（选中行是系统高亮色），CSS 够不着。
 *
 * **面板挂在 body**（portal）：设置卡是 `overflow-hidden rounded-container`（圆角靠它切），
 * 留在行里会被裁成只露第一项。
 * ⚠️ 计划 7 起这段由 Radix 负责：`DropdownMenuContent` 自己 portal，定位交给 popper。
 * 原先这里写着「用固定定位 + 打开时量好的坐标，坐标必须在渲染前算好以免首帧闪一下」
 * —— **那套代码已整块删除**，别照着旧文档去找它。
 *
 * **键盘**：触发按钮上 ↓/↑ 都能打开菜单（↑ 由本组件的 onKeyDown 补，Radix 只认 ↓）；
 * 菜单内 ↓/↑ 移动并**回绕**（靠 `DropdownMenuContent` 的 `loop` —— Radix 默认**不**回绕，
 * 漏了它就是静默丢契约）；Enter/Space 选中；Esc **或 Tab** 关闭并把焦点还给触发按钮
 * （Tab 由本组件挂在内容上的 `onKeyDown` 兜住：Radix 的菜单默认会 preventDefault 掉 Tab）。
 * ⚠️ 焦点落点变了：**打开时落在第一项**（原实现落在当前值那一项 ✗）—— Radix 的入口焦点
 * 由它的 roving focus 自己管，手动聚焦会与它打架（不更新 currentTabStopId）✗。
 * ⚠️ Radix 还**多了首字母跳转**（typeahead），原实现没有。
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * 关掉并把焦点还给触发按钮。
   *
   * Radix 关闭时**自己**会把焦点还给触发器（`onCloseAutoFocus`）✓ —— 所以这里
   * 只用在 **Tab** 这一条上：Radix 的菜单会 `preventDefault` 掉 Tab（模态菜单的
   * 行为），而本组件的原契约是「Esc **或 Tab** 关闭并把焦点还给触发按钮」。
   * 靠把 `onKeyDown` 传给 `DropdownMenuContent` 保住 —— Radix 是用
   * `composeEventHandlers(contentProps.onKeyDown, …)` 组装的，**调用方先跑、
   * 且一旦 preventDefault 就跳过 Radix 的**（读源码核实，见 ledger Task 1 ③）。
   */
  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          ref={triggerRef}
          type="button"
          data-testid={testId}
          disabled={disabled}
          // onKeyDown 只为 **ArrowUp** 打开：Radix 的触发器只认 ArrowDown
          //（读源码核实），而原实现 ↑/↓ 都能开。其余键交给 Radix。
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" || open) return;
            event.preventDefault(); // 否则方向键会去滚动页面
            setOpen(true);
          }}
          aria-label={label}
          className="inline-flex items-center gap-1.5 rounded-control border border-border bg-card px-2.5 py-1 text-xs text-foreground outline-none hover:bg-accent disabled:opacity-50"
        >
          <span className="whitespace-nowrap">{current?.label ?? value}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        // ⚠️ loop 必须显式给：Radix 的菜单**默认不回荡**（loop = false），
        // 而本组件原契约是「↓/↑ 移动（**回绕**）」—— 不写这一行就是静默丢掉它。
        loop
        // Tab 的原契约见 closeAndFocusTrigger 的注释。
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          closeAndFocusTrigger();
        }}
        aria-label={label}
        data-testid={testId ? `${testId}-menu` : undefined}
        // ⚠️ 更正一处原先写错的注释：vendored 的 DropdownMenuContent **已经有**
        // `max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto
        // overflow-x-hidden`（见 ui/dropdown-menu.tsx）。
        // 这里的 max-h-[264px] 是**有意**与原面板的 maxHeight:264 对齐的常量上限 ——
        // 代价是**放弃**了 Radix 那个自适应视口的软上限。若哪天希望长列表跟着视口走，
        // 把这一段删掉即可（vendored 的 var 上限会接手）。
        // min-w 用 Radix 公布的触发器宽度变量，恢复原实现 `minWidth: rect.minWidth`
        // 的不变量（面板至少与触发器同宽）—— 原来写的 min-w-[8rem] 只是个固定下限，
        // 触发器比它宽时面板会变窄、长文案被 truncate 掉。
        className="max-h-[264px] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            // 受控值不同才回传（原语义，见 settings-menu-helper 的注释）
            if (next !== value) onChange(next as T);
          }}
        >
          {/* ⚠️ **契约变更**（已记录）：原实现「打开时聚焦**当前值**那一项」，现在
              Radix 聚焦**第一项** ✗。
              原因：Radix 的 dropdown 刻意 `Omit` 了 `onEntryFocus`，也**没有**
              `onOpenAutoFocus`（只有 onCloseAutoFocus ✗）—— 入口焦点由它的 roving
              focus 自己管。我试过用一个随内容挂载的子组件手动聚焦，结果**与 roving
              focus 打架**：手动 focus 不更新 Radix 的 currentTabStopId，随后的
              ArrowDown 会从它的起点跳错项 ✗（既有测试「键盘：方向键开菜单与移动」
              抓到了这一点）。
              代价：键盘用户少了「方向键从当前值起步」这一个便利 —— 但 ↑/↓/Enter/Esc
              都仍可用，且焦点仍在菜单内 ✓。要恢复得自己实现一套 roving focus
              （那等于放弃 Radix 的菜单键盘模型 ✗），故不在此做。 */}
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              data-testid={
                testId ? `${testId}-option-${option.value}` : undefined
              }
              className="h-7 gap-2 pr-2"
            >
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type StatusBadgeTone = "ok" | "muted" | "busy" | "error";

/** 状态徽标的点色。tone → 语义 token，不硬编码色值。 */
const STATUS_BADGE_DOTS = {
  ok: "bg-success",
  muted: "bg-muted-foreground",
  busy: "bg-primary",
  error: "bg-destructive",
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
      className="ml-2 inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-muted px-2 py-0.5 text-xs text-muted-foreground"
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
        className="h-1.5 w-full overflow-hidden rounded-full bg-accent"
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** 表单字段形态的下拉（占满一行的输入框外观）。
 *
 * 与 `SettingsSelect` 的分工：那个是**设置行右侧的小胶囊**（`text-xs`、随内容宽度）；
 * 这个是**表单里的整行字段**（`text-sm`、默认 `w-full`、左侧对齐、右侧箭头），
 * 用来替代原先的**原生 `<select>`** —— 原生控件的展开菜单由操作系统绘制，跟随系统
 * 外观而不是 app 主题（浅色主题 + 深色系统会弹出系统深色菜单，CSS 够不着），
 * 所以设置页里的原生 `<select>` 全部换成这一套 Radix 菜单。
 *
 * 契约：
 * - 触发器是 `button`（原生的 `select` 换成它 ⇒ 无障碍名要靠 `label` 传给 aria-label，
 *   原本包在外面的 `<label>` 仍然有效，但显式给更稳）；
 * - `options` 里**可以带一个 `value: ""` 的占位项**（原来的 `<option value="">`），
 *   选它就等价于「清空」；`placeholder` 只在当前值不在 options 里时兜底显示；
 * - 选中当前项**不回传**（原生 select 重选同项不触发 change，这里保持同语义）；
 * - 面板经 portal 挂到 body，`align="start"`、`loop`（Radix 默认不回绕，与
 *   `SettingsSelect` 一致），长列表有 `max-h-[264px]` 上限。
 */
export interface SettingsFormSelectOption<T extends string> {
  value: T;
  label: string;
}

export function SettingsFormSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder,
  disabled = false,
  testId,
  triggerClassName,
}: {
  value: T;
  options: Array<SettingsFormSelectOption<T>>;
  onChange: (next: T) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  /** 覆盖默认的宽度类（默认 `w-full`；并排布局里传 `flex-1`）。 */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          data-testid={testId}
          disabled={disabled}
          aria-label={label}
          className={`flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-left text-sm text-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 ${triggerClassName ?? "w-full"}`}
        >
          <span className="truncate">
            {current?.label ?? placeholder ?? value}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        loop
        aria-label={label}
        data-testid={testId ? `${testId}-menu` : undefined}
        className="max-h-[264px] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) onChange(next as T);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              data-testid={
                testId ? `${testId}-option-${option.value}` : undefined
              }
              className="gap-2 pr-2"
            >
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
