import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useIPC } from "../../hooks/useIPC";
import { Search as SearchIcon, RotateCcw, Trash2 } from "lucide-react";

export function SettingsArchived() {
  const { t } = useTranslation();
  const { unarchiveSession, batchUnarchiveSessions, permanentDeleteArchived } =
    useIPC();
  const sessions = useAppStore((s) => s.sessions);

  const archivedSessions = useMemo(
    () => sessions.filter((s) => s.archived),
    [sessions],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q
      ? archivedSessions.filter((s) => s.title.toLowerCase().includes(q))
      : archivedSessions;
  }, [archivedSessions, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRestore = (sessionId: string) => {
    unarchiveSession(sessionId);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  };

  const handleBatchRestore = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    batchUnarchiveSessions(ids);
    setSelectedIds(new Set());
  };

  const handlePermanentDelete = (sessionId: string) => {
    permanentDeleteArchived(sessionId);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  };

  if (archivedSessions.length === 0) {
    return (
      <div className="rounded-2xl border border-border-muted bg-surface-muted/60 px-6 py-12 text-center">
        <p className="text-sm text-text-muted">
          {t("sidebar.noArchivedSessions")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + Actions */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("sidebar.search")}
            className="w-full rounded-xl border border-border-muted bg-surface-muted pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border focus:bg-background transition-colors"
          />
        </div>
        <button
          onClick={handleBatchRestore}
          disabled={selectedIds.size === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-accent hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t("sidebar.batchRestore")}
        </button>
      </div>

      {/* List */}
      <div className="space-y-0.5">
        {filteredSessions.map((session) => {
          const isSelected = selectedIds.has(session.id);
          return (
            <div
              key={session.id}
              onClick={() => toggleSelect(session.id)}
              className={`group cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                isSelected ? "bg-accent-muted/20" : "hover:bg-surface-hover/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "border border-border-muted bg-background"
                  }`}
                >
                  {isSelected && (
                    <svg
                      className="w-2.5 h-2.5"
                      viewBox="0 0 10 10"
                      fill="none"
                    >
                      <path
                        d="M2 5l2 2 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {session.title}
                  </div>
                  <div className="text-xs text-text-muted">
                    {session.archivedAt
                      ? new Date(session.archivedAt).toLocaleDateString()
                      : ""}
                    {session.cwd
                      ? ` · ${session.cwd.split("/").pop() || session.cwd.split("\\").pop()}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRestore(session.id);
                    }}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-accent hover:bg-surface-active transition-colors"
                    title={t("sidebar.restore")}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePermanentDelete(session.id);
                    }}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-active transition-colors"
                    title={t("common.delete")}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="text-sm text-text-muted">
        {selectedIds.size > 0
          ? t("sidebar.nSelected", { count: selectedIds.size })
          : `${filteredSessions.length} ${t("sidebar.archivedSessions").toLowerCase()}`}
      </div>
    </div>
  );
}
