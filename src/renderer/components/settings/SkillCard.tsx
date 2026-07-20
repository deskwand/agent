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
} from "lucide-react";
import type { Skill, CloudSkill, SkillType } from "../../types";

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
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`shrink-0 p-1.5 rounded-md transition-colors ${
        enabled
          ? "bg-success/10 text-success hover:bg-success/20"
          : "bg-surface-muted text-text-muted hover:bg-surface-active"
      }`}
      title={label}
    >
      {enabled ? (
        <Power className="w-3.5 h-3.5" />
      ) : (
        <PowerOff className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/* ─── icon mapping ─── */

export type SkillSource =
  | "ai"
  | "custom"
  | "mycloud"
  | "team"
  | "builtin"
  | "marketplace";

const SKILL_ICON_MAP: Record<
  SkillSource,
  { icon: typeof Bot; bgClass: string; iconClass: string; strokeWidth: number }
> = {
  ai: {
    icon: Bot,
    bgClass: "bg-accent",
    iconClass: "text-accent-foreground",
    strokeWidth: 2,
  },
  mycloud: {
    icon: Cloud,
    bgClass: "bg-accent",
    iconClass: "text-accent-foreground",
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
    bgClass: "bg-surface-muted",
    iconClass: "text-text-muted",
    strokeWidth: 2,
  },
  marketplace: {
    icon: Package,
    bgClass: "bg-accent",
    iconClass: "text-accent-foreground",
    strokeWidth: 2,
  },
};

function getSkillIcon(source: SkillSource) {
  return SKILL_ICON_MAP[source] ?? SKILL_ICON_MAP.custom;
}

/* ─── unified display type ─── */

export interface DisplaySkill {
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

  return (
    <>
      {onPublish && publishStatus !== "has_update" && (
        <button
          onClick={onPublish}
          disabled={isLoading || isPublishing || publishStatus === "published"}
          className={`p-1.5 rounded-md transition-colors ${
            publishStatus === "published"
              ? "bg-success/10 text-success cursor-default"
              : publishStatus === "outdated"
                ? "bg-accent/10 text-accent hover:bg-accent/20"
                : isPublishing
                  ? "bg-accent/10 text-accent/50 cursor-wait"
                  : "bg-accent/10 text-accent hover:bg-accent/20"
          }`}
          title={
            publishStatus === "published"
              ? ""
              : publishStatus === "outdated"
                ? t("skillMarket.publishUpdate")
                : t("skillMarket.publish")
          }
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
        </button>
      )}
      {onUpdate && publishStatus === "has_update" && (
        <button
          onClick={onUpdate}
          disabled={isLoading || isUpdating}
          className={`p-1.5 rounded-md transition-colors ${
            isUpdating
              ? "bg-accent/10 text-accent/50 cursor-wait"
              : "bg-accent/10 text-accent hover:bg-accent/20"
          }`}
          title={t("skillMarket.update")}
        >
          {isUpdating ? (
            <Loader2 className={`${iconSize} animate-spin`} />
          ) : (
            <Download className={iconSize} />
          )}
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          disabled={isLoading}
          className="p-1.5 rounded-md bg-error/10 text-error hover:bg-error/20 transition-colors"
          title={t("common.delete")}
        >
          <Trash2 className={iconSize} />
        </button>
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
              <button
                onClick={onSkillMd}
                className="text-base font-semibold text-text-primary hover:text-accent transition-colors truncate text-left"
              >
                {skill.name}
              </button>
            ) : (
              <h3 className="text-base font-semibold text-text-primary truncate">
                {skill.name}
              </h3>
            )}
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-muted text-text-muted shrink-0 whitespace-nowrap">
              {sourceLabel}
            </span>
          </div>
          {footer && (
            <p className="text-sm text-text-secondary line-clamp-2">{footer}</p>
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
                <button
                  onClick={onSkillMd}
                  className="text-sm font-medium text-text-primary truncate hover:text-accent transition-colors text-left"
                >
                  {skill.name}
                </button>
              ) : (
                <span className="text-sm font-medium text-text-primary truncate">
                  {skill.name}
                </span>
              )}
              <span className="text-[10px] px-1 py-0.5 rounded bg-surface-muted text-text-muted shrink-0 whitespace-nowrap">
                {sourceLabel}
              </span>
            </div>
            {footer && (
              <p className="text-xs text-text-muted line-clamp-1">{footer}</p>
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
              <button
                onClick={onSkillMd}
                className="text-base font-semibold text-text-primary hover:text-accent transition-colors truncate text-left"
              >
                {name}
              </button>
            ) : (
              <h3 className="text-base font-semibold text-text-primary truncate">
                {name}
              </h3>
            )}
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-muted text-text-muted shrink-0 whitespace-nowrap">
              {sourceLabel}
            </span>
          </div>
          {description && (
            <p className="text-sm text-text-secondary line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <button
          onClick={onInstall}
          disabled={installing}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {installing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          {t("skillMarket.install")}
        </button>
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
                <button
                  onClick={onSkillMd}
                  className="text-sm font-medium text-text-primary truncate hover:text-accent transition-colors text-left"
                >
                  {name}
                </button>
              ) : (
                <span className="text-sm font-medium text-text-primary truncate">
                  {name}
                </span>
              )}
              <span className="text-[10px] px-1 py-0.5 rounded bg-surface-muted text-text-muted shrink-0 whitespace-nowrap">
                {sourceLabel}
              </span>
            </div>
            {description && (
              <p className="text-xs text-text-muted line-clamp-1">
                {description}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onInstall}
          disabled={installing}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {installing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          {t("skillMarket.install")}
        </button>
      </div>
    </div>
  );
}

export function CloudOnlySkillCard(props: CloudOnlySkillCardProps) {
  if (props.viewMode === "cards") return <CloudOnlyCardView {...props} />;
  return <CloudOnlyListView {...props} />;
}
