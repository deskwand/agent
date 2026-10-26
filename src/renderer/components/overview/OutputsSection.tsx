import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useActiveTraceSteps, useCurrentSession } from "../../store/selectors";
import { buildArtifactItems } from "../../utils/artifact-steps";
import { getFileKind } from "../../utils/file-types";
import { FileTypeIcon } from "../file-type-icon";
import { useOpenArtifact } from "../../hooks/use-open-artifact";
import { OverviewSection } from "./OverviewSection";

const COLLAPSED_COUNT = 5;

export function OutputsSection() {
  const { t } = useTranslation();
  const steps = useActiveTraceSteps();
  const session = useCurrentSession();
  const workingDir = useAppStore((s) => s.workingDir);
  const { openArtifact } = useOpenArtifact();
  const [expanded, setExpanded] = useState(false);

  const cwd = session?.cwd || workingDir;
  // buildArtifactItems 按写入顺序（旧→新）返回；概览要求最新的在前
  const items = useMemo(
    () => buildArtifactItems(steps, cwd).slice().reverse(),
    [steps, cwd],
  );
  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  const hiddenCount = items.length - visible.length;

  return (
    <OverviewSection titleKey="overview.outputs.title">
      {items.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {t("overview.outputs.empty")}
        </p>
      )}
      {visible.map((item) => {
        const parentDir = item.path.split(/[\\/]/).slice(-2, -1)[0];
        return (
          <button
            key={item.path}
            type="button"
            aria-label={item.label}
            title={item.path}
            onClick={() => {
              void openArtifact(item.path, item.label);
            }}
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-accent"
          >
            <FileTypeIcon kind={getFileKind(item.path)} size={14} />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {item.label}
            </span>
            {parentDir && (
              <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">
                {parentDir}
              </span>
            )}
          </button>
        );
      })}
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-label={t("overview.outputs.showMore")}
          onClick={() => setExpanded(true)}
          className="w-full rounded px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
        >
          {t("overview.outputs.showMore", { count: hiddenCount })}
        </button>
      )}
      {expanded && items.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-full rounded px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
        >
          {t("overview.outputs.showLess")}
        </button>
      )}
    </OverviewSection>
  );
}
