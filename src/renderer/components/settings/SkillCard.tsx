import type { ReactNode } from "react";
import {
  Bot,
  Cloud,
  Users,
  FileCode,
  Package,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
  CloudUpload,
  Check,
  Loader2,
  Download,
  ShieldCheck,
  FolderOpen,
} from "lucide-react";
import type { Skill, CloudSkill, SkillType } from "../../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { Button } from "../app-button";

/* ─── tiny internals ─── */

function ToggleButton({
  enabled,
  isLoading,
  onToggle,
  label,
}: {
  enabled: boolean;
  isLoading: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost"
          onClick={onToggle}
          disabled={isLoading}
          className={`shrink-0 p-1.5 rounded-md transition-colors ${
            enabled
              ? "bg-success/10 text-success hover:bg-success/20"
              : "bg-muted text-muted-foreground hover:bg-selected-surface"
          }`}
          aria-label={label}
        >
          {enabled ? (
            <Power className="w-3.5 h-3.5" />
          ) : (
            <PowerOff className="w-3.5 h-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      {/* side 必须显式给 bottom：vendored TooltipContent 的 Radix 默认是 top，
          而老 Tooltip 的 placement 默认是下方 —— 不写会把气泡挪到按钮上方。 */}
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/* ─── icon mapping ─── */

export type SkillSource =
  | "ai"
  | "custom"
  | "mycloud"
  | "team"
  | "builtin"
  | "marketplace"
  | "vault"
  | "external";

export const SKILL_ICON_MAP: Record<
  SkillSource,
  { icon: typeof Bot; bgClass: string; iconClass: string; strokeWidth: number }
> = {
  ai: {
    icon: Bot,
    bgClass: "bg-primary",
    iconClass: "text-primary-foreground",
    strokeWidth: 2,
  },
  mycloud: {
    icon: Cloud,
    bgClass: "bg-primary",
    iconClass: "text-primary-foreground",
    strokeWidth: 2,
  },
  team: {
    icon: Users,
    bgClass: "bg-warning",
    iconClass: "text-warning-foreground",
    strokeWidth: 2,
  },
  custom: {
    icon: FileCode,
    bgClass: "bg-success",
    iconClass: "text-success-foreground",
    strokeWidth: 2,
  },
  builtin: {
    icon: Package,
    bgClass: "bg-muted",
    iconClass: "text-muted-foreground",
    strokeWidth: 2,
  },
  marketplace: {
    icon: Package,
    bgClass: "bg-primary",
    iconClass: "text-primary-foreground",
    strokeWidth: 2,
  },
  vault: {
    icon: ShieldCheck,
    bgClass: "bg-primary",
    iconClass: "text-primary-foreground",
    strokeWidth: 2,
  },
  external: {
    icon: FolderOpen,
    bgClass: "bg-muted",
    iconClass: "text-muted-foreground",
    strokeWidth: 2,
  },
};

function getSkillIcon(source: SkillSource) {
  return SKILL_ICON_MAP[source] ?? SKILL_ICON_MAP.custom;
}

/* ─── unified display type ─── */

export interface DisplaySkill {
  /** 第三方技能与已启用的产品技能同名 ⇒ 当前不生效（产品名优先）。 */
  shadowedByProduct?: boolean;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  type: SkillType;
  source: SkillSource;
  sourceTeam?: string;
  cloudMembership?: "mycloud" | "team";
  isCloudOnly: boolean;
  cloudData?: CloudSkill;
  createdAt: number;
}

/* ─── SkillCard ─── */

export interface SkillCardProps {
  skill: Skill;
  isLoading: boolean;
  onToggle: () => void;
  footer: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onDelete?: () => void;
  onPublish?: () => void;
  onUpdate?: () => void;
  publishStatus?: "unpublished" | "published" | "outdated" | "has_update";
  isPublishing?: boolean;
  isUpdating?: boolean;
  onSkillMd?: () => void;
  viewMode: "cards" | "list";
  source: SkillSource;
  sourceLabel: string;
  cloudOps?: ReactNode;
}

/* ── shared action buttons ── */

interface SkillActionButtonsProps {
  onPublish?: () => void;
  onUpdate?: () => void;
  onDelete?: () => void;
  publishStatus?: "unpublished" | "published" | "outdated" | "has_update";
  isPublishing?: boolean;
  isUpdating?: boolean;
  isLoading: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  iconSize?: string;
}

function SkillActionButtons(props: SkillActionButtonsProps) {
  const {
    onPublish,
    onUpdate,
    onDelete,
    publishStatus,
    isPublishing,
    isUpdating,
    isLoading,
    t,
    iconSize = "w-3.5 h-3.5",
  } = props;

  // 已发布态沿用改造前的语义：没有提示（空 label 时 Tooltip 只渲染 children）。
  const publishTipLabel =
    publishStatus === "published"
      ? ""
      : publishStatus === "outdated"
        ? t("skillMarket.publishUpdate")
        : t("skillMarket.publish");

  const publishButton = (
    <Button variant="ghost"
      onClick={onPublish}
      disabled={isLoading || isPublishing || publishStatus === "published"}
      aria-label={publishTipLabel || undefined}
      className={`p-1.5 rounded-md transition-colors ${
        publishStatus === "published"
          ? "bg-success/10 text-success cursor-default"
          : publishStatus === "outdated"
            ? "bg-primary/10 text-primary-text hover:bg-primary/20"
            : isPublishing
              ? "bg-primary/10 text-primary-text/50 cursor-wait"
              : "bg-primary/10 text-primary-text hover:bg-primary/20"
      }`}
    >
      {isPublishing ? (
        <Loader2 className={`${iconSize} animate-spin`} />
      ) : publishStatus === "published" ? (
        <Check className={iconSize} />
      ) : publishStatus === "outdated" ? (
        <RefreshCw className={iconSize} />
      ) : (
        <CloudUpload className={iconSize} />
      )}
    </Button>
  );

  return (
    <>
      {/* 空 label ⇒ 真的**不包** Tooltip（老组件 `if (!hasLabel) return <>{children}</>`）：
          包一个空气泡会让 aria-describedby 指向不存在的 id。 */}
      {onPublish &&
        publishStatus !== "has_update" &&
        (publishTipLabel ? (
          <Tooltip>
            <TooltipTrigger asChild>{publishButton}</TooltipTrigger>
            <TooltipContent side="bottom">{publishTipLabel}</TooltipContent>
          </Tooltip>
        ) : (
          publishButton
        ))}
      {onUpdate && publishStatus === "has_update" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost"
              onClick={onUpdate}
              disabled={isLoading || isUpdating}
              className={`p-1.5 rounded-md transition-colors ${
                isUpdating
                  ? "bg-primary/10 text-primary-text/50 cursor-wait"
                  : "bg-primary/10 text-primary-text hover:bg-primary/20"
              }`}
              aria-label={t("skillMarket.update")}
            >
              {isUpdating ? (
                <Loader2 className={`${iconSize} animate-spin`} />
              ) : (
                <Download className={iconSize} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("skillMarket.update")}
          </TooltipContent>
        </Tooltip>
      )}
      {onDelete && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost"
              onClick={onDelete}
              disabled={isLoading}
              className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors h-auto"
              aria-label={t("common.delete")}
            >
              <Trash2 className={iconSize} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("common.delete")}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

/* ── card view (2-column grid) ── */

function SkillCardCards(props: SkillCardProps) {
  const {
    skill,
    isLoading,
    onToggle,
    footer,
    t,
    source,
    sourceLabel,
    cloudOps,
    onSkillMd,
  } = props;
  const { icon: Icon, bgClass, iconClass, strokeWidth } = getSkillIcon(source);
  const iconSize = 48;

  return (
    <div className="rounded-lg border border-border p-4">
      {/* Top: icon + name + source tag */}
      <div className="flex items-start gap-3">
        <div
          className={`rounded-lg flex items-center justify-center shrink-0 ${bgClass}`}
          style={{ width: iconSize, height: iconSize }}
        >
          <Icon className={`w-6 h-6 ${iconClass}`} strokeWidth={strokeWidth} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {onSkillMd ? (
              <Button variant="ghost"
                onClick={onSkillMd}
                className="text-base font-semibold text-foreground hover:text-primary-text transition-colors truncate text-left h-auto px-0"
              >
                {skill.name}
              </Button>
            ) : (
              <h3 className="text-base font-semibold text-foreground truncate">
                {skill.name}
              </h3>
            )}
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 whitespace-nowrap">
              {sourceLabel}
            </span>
          </div>
          {footer && (
            <p className="text-sm text-muted-foreground line-clamp-2">{footer}</p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mt-3">
        <ToggleButton
          enabled={skill.enabled}
          isLoading={isLoading}
          onToggle={onToggle}
          label={skill.enabled ? t("common.disable") : t("common.enable")}
        />
        <div className="flex items-center gap-1">
          <SkillActionButtons {...props} />
          {cloudOps && (
            <>
              <span className="w-px h-4 bg-border mx-0.5" />
              {cloudOps}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── list view (1-column compact) ── */

function SkillCardList(props: SkillCardProps) {
  const {
    skill,
    isLoading,
    onToggle,
    footer,
    t,
    source,
    sourceLabel,
    onSkillMd,
  } = props;
  const { icon: Icon, bgClass, iconClass, strokeWidth } = getSkillIcon(source);
  const iconSize = 36;

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`rounded-lg flex items-center justify-center shrink-0 ${bgClass}`}
            style={{ width: iconSize, height: iconSize }}
          >
            <Icon
              className={`w-4 h-4 ${iconClass}`}
              strokeWidth={strokeWidth}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {onSkillMd ? (
                <Button variant="ghost"
                  onClick={onSkillMd}
                  className="text-sm font-medium text-foreground truncate hover:text-primary-text transition-colors text-left h-auto px-0"
                >
                  {skill.name}
                </Button>
              ) : (
                <span className="text-sm font-medium text-foreground truncate">
                  {skill.name}
                </span>
              )}
              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0 whitespace-nowrap">
                {sourceLabel}
              </span>
            </div>
            {footer && (
              <p className="text-xs text-muted-foreground line-clamp-1">{footer}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <SkillActionButtons {...props} />
          {props.cloudOps && (
            <>
              <span className="w-px h-4 bg-border mx-0.5" />
              {props.cloudOps}
            </>
          )}
          <ToggleButton
            enabled={skill.enabled}
            isLoading={isLoading}
            onToggle={onToggle}
            label={skill.enabled ? t("common.disable") : t("common.enable")}
          />
        </div>
      </div>
    </div>
  );
}

export function SkillCard(props: SkillCardProps) {
  if (props.viewMode === "cards") return <SkillCardCards {...props} />;
  return <SkillCardList {...props} />;
}

/* ─── CloudOnlySkillCard ─── */

interface CloudOnlySkillCardProps {
  name: string;
  description: string;
  source: SkillSource;
  sourceLabel: string;
  onInstall: () => void;
  installing: boolean;
  onSkillMd?: () => void;
  viewMode: "cards" | "list";
  t: (key: string, options?: Record<string, unknown>) => string;
}

function CloudOnlyCardView(props: CloudOnlySkillCardProps) {
  const {
    name,
    description,
    source,
    sourceLabel,
    onInstall,
    installing,
    onSkillMd,
    t,
  } = props;
  const { icon: Icon, bgClass, iconClass, strokeWidth } = getSkillIcon(source);
  const iconSize = 48;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <div
          className={`rounded-lg flex items-center justify-center shrink-0 ${bgClass}`}
          style={{ width: iconSize, height: iconSize }}
        >
          <Icon className={`w-6 h-6 ${iconClass}`} strokeWidth={strokeWidth} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {onSkillMd ? (
              <Button variant="ghost"
                onClick={onSkillMd}
                className="text-base font-semibold text-foreground hover:text-primary-text transition-colors truncate text-left h-auto px-0"
              >
                {name}
              </Button>
            ) : (
              <h3 className="text-base font-semibold text-foreground truncate">
                {name}
              </h3>
            )}
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 whitespace-nowrap">
              {sourceLabel}
            </span>
          </div>
          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <Button variant="ghost"
          onClick={onInstall}
          disabled={installing}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary-text hover:bg-primary/20 transition-colors disabled:opacity-50 h-auto"
        >
          {installing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          {t("skillMarket.install")}
        </Button>
      </div>
    </div>
  );
}

function CloudOnlyListView(props: CloudOnlySkillCardProps) {
  const {
    name,
    description,
    source,
    sourceLabel,
    onInstall,
    installing,
    onSkillMd,
    t,
  } = props;
  const { icon: Icon, bgClass, iconClass, strokeWidth } = getSkillIcon(source);
  const iconSize = 36;

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`rounded-lg flex items-center justify-center shrink-0 ${bgClass}`}
            style={{ width: iconSize, height: iconSize }}
          >
            <Icon
              className={`w-4 h-4 ${iconClass}`}
              strokeWidth={strokeWidth}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {onSkillMd ? (
                <Button variant="ghost"
                  onClick={onSkillMd}
                  className="text-sm font-medium text-foreground truncate hover:text-primary-text transition-colors text-left h-auto px-0"
                >
                  {name}
                </Button>
              ) : (
                <span className="text-sm font-medium text-foreground truncate">
                  {name}
                </span>
              )}
              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0 whitespace-nowrap">
                {sourceLabel}
              </span>
            </div>
            {description && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {description}
              </p>
            )}
          </div>
        </div>
        <Button variant="ghost"
          onClick={onInstall}
          disabled={installing}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary-text hover:bg-primary/20 transition-colors disabled:opacity-50 h-auto"
        >
          {installing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          {t("skillMarket.install")}
        </Button>
      </div>
    </div>
  );
}

export function CloudOnlySkillCard(props: CloudOnlySkillCardProps) {
  if (props.viewMode === "cards") return <CloudOnlyCardView {...props} />;
  return <CloudOnlyListView {...props} />;
}
