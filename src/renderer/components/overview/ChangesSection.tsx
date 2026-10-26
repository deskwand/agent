import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useSandboxSyncStatus } from "../../store/selectors";
import type { RepoSummaryResult } from "../../hooks/use-repo-summary";
import { formatChangeCount } from "../../utils/overview-format";
import { OverviewSection } from "./OverviewSection";

const SYNCING_PHASES = new Set([
  "starting_agent",
  "syncing_files",
  "syncing_skills",
]);

export function ChangesSection({
  cwd,
  repo,
}: {
  cwd: string | null;
  repo: RepoSummaryResult;
}) {
  const { t } = useTranslation();
  const openReview = useAppStore((s) => s.openReview);
  const syncStatus = useSandboxSyncStatus();
  const summary = repo.summary;

  let body: ReactNode;
  if (!cwd) {
    body = (
      <p className="px-1 text-xs text-muted-foreground">
        {t("overview.env.noFolder")}
      </p>
    );
  } else if (repo.error) {
    body = (
      <p className="px-1 text-xs text-muted-foreground" title={repo.error}>
        — {t("overview.changes.failed")}
      </p>
    );
  } else if (!summary) {
    body = (
      <p className="px-1 text-xs text-muted-foreground">
        {t("overview.changes.loading")}
      </p>
    );
  } else if (!summary.isRepo) {
    body = (
      <p className="px-1 text-xs text-muted-foreground">
        {t("overview.changes.notRepo")}
      </p>
    );
  } else {
    body = (
      <button
        type="button"
        onClick={openReview}
        aria-label={t("overview.changes.open")}
        className="w-full rounded px-1 py-1 text-left hover:bg-hover-surface"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-medium tabular-nums text-success">
            +{formatChangeCount(summary.additions)}
          </span>
          <span className="text-sm font-medium tabular-nums text-destructive">
            −{formatChangeCount(summary.deletions)}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {t("overview.changes.files", { count: summary.changedFiles })}
          </span>
        </span>
        {summary.untracked > 0 && (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {t("overview.changes.untracked", { count: summary.untracked })}
          </span>
        )}
      </button>
    );
  }

  return (
    <OverviewSection titleKey="overview.changes.title">
      {body}
      {syncStatus && SYNCING_PHASES.has(syncStatus.phase) && (
        <p className="px-1 text-[11px] text-muted-foreground">
          {t("overview.changes.syncing")}
        </p>
      )}
    </OverviewSection>
  );
}
