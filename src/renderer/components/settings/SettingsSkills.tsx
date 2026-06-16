import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Package,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
} from "lucide-react";
import type { Skill } from "../../types";
import type { LocalizedBanner } from "./shared";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

/* ─── tiny internals ─── */

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <div
      className={`w-2 h-2 rounded-full shrink-0 ${
        enabled ? "bg-success" : "bg-text-muted"
      }`}
    />
  );
}

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

function formatTimeAgo(
  ts: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return t("skills.justNow");
  if (seconds < 3600)
    return t("skills.minutesAgo", { n: Math.floor(seconds / 60) });
  if (seconds < 86400)
    return t("skills.hoursAgo", { n: Math.floor(seconds / 3600) });
  return t("skills.daysAgo", { n: Math.floor(seconds / 86400) });
}

/* ─── shared card (used by both tabs) ─── */

interface SkillCardProps {
  skill: Skill;
  isLoading: boolean;
  onToggle: () => void;
  footer: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onDelete?: () => void;
}

function SkillCard({
  skill,
  isLoading,
  onToggle,
  footer,
  t,
  onDelete,
}: SkillCardProps) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot enabled={skill.enabled} />
          <span className="text-sm font-medium text-text-primary truncate">
            {skill.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ToggleButton
            enabled={skill.enabled}
            isLoading={isLoading}
            onToggle={onToggle}
            label={skill.enabled ? t("common.disable") : t("common.enable")}
          />
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="p-1.5 rounded-md bg-error/10 text-error hover:bg-error/20 transition-colors"
              title={t("common.delete")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {footer && (
        <p className="text-xs text-text-muted ml-4 mt-1 line-clamp-1">
          {footer}
        </p>
      )}
    </div>
  );
}

/* ─── main component ─── */

export function SettingsSkills({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [tab, setTab] = useState<"builtin" | "agent" | "custom">("builtin");

  const loadSkills = useCallback(
    async (silent = false) => {
      try {
        const result = await window.electronAPI.skills.getAll();
        setSkills(result || []);
        if (!silent) setError(null);
      } catch (err) {
        console.error("Failed to load skills:", err);
        if (!silent) {
          setError({
            text:
              err instanceof Error && err.message
                ? `${t("skills.failedToLoad")}: ${err.message}`
                : t("skills.failedToLoad"),
          });
        }
      }
    },
    [t],
  );

  useEffect(() => {
    if (!isElectron || !isActive) return;
    void loadSkills();
  }, [isActive, loadSkills]);

  async function handleRefresh() {
    setIsLoading(true);
    try {
      await loadSkills();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(skillId: string, skillName: string) {
    if (!confirm(t("skills.deleteSkill", { name: skillName }))) return;
    setIsLoading(true);
    try {
      await window.electronAPI.skills.delete(skillId);
      await loadSkills();
    } catch (err) {
      setError({
        text: err instanceof Error ? err.message : t("skills.failedToDelete"),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggle(skill: Skill) {
    setIsLoading(true);
    try {
      await window.electronAPI.skills.setEnabled(skill.id, !skill.enabled);
      await loadSkills();
    } catch (err) {
      setError({
        text: err instanceof Error ? err.message : t("skills.failedToToggle"),
      });
    } finally {
      setIsLoading(false);
    }
  }

  const builtin = skills.filter((s) => s.type === "builtin");
  const agent = skills.filter((s) => s.type === "agent");
  const custom = skills.filter((s) => s.type === "custom");

  /* ─── render ─── */

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error.key ? t(error.key) : error.text}
        </div>
      )}

      {/* tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5">
          {(["builtin", "agent", "custom"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-surface text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {t(`skills.${key}Skills`)}
            </button>
          ))}
        </div>
        {(tab === "agent" || tab === "custom") && (
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="py-1 px-2.5 rounded-md border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center gap-1 text-[11px] text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" />
            {t("skills.refreshSkills")}
          </button>
        )}
      </div>

      {/* active tab content */}
      {tab === "builtin" ? (
        builtin.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t("skills.noBuiltinSkills")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            {builtin.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isLoading={isLoading}
                onToggle={() => handleToggle(skill)}
                footer={skill.description || null}
                t={t}
              />
            ))}
          </div>
        )
      ) : tab === "agent" ? (
        agent.length === 0 ? (
          <div className="text-center py-4 text-text-muted">
            <Package className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
            <p className="text-sm">{t("skills.noAgentSkills")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {agent.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isLoading={isLoading}
                onToggle={() => handleToggle(skill)}
                onDelete={() => handleDelete(skill.id, skill.name)}
                footer={skill.description || formatTimeAgo(skill.createdAt, t)}
                t={t}
              />
            ))}
          </div>
        )
      ) : custom.length === 0 ? (
        <div className="text-center py-4 text-text-muted">
          <Package className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
          <p className="text-sm">{t("skills.noCustomSkills")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {custom.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              isLoading={isLoading}
              onToggle={() => handleToggle(skill)}
              onDelete={() => handleDelete(skill.id, skill.name)}
              footer={skill.description || formatTimeAgo(skill.createdAt, t)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}
