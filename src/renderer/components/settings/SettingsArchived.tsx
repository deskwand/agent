import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useIPC } from "../../hooks/useIPC";
import { Search as SearchIcon, RotateCcw, Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../app-button";

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
      <div className="rounded-2xl border border-border/60 bg-muted/60 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
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
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          {/* ⚠️ 2026-10-09：换成 shadcn 的 `Input` ✓ —— 本仓输入框是**全自定义观感** ✗，
              而 `Input` 自带 `h-9 rounded-md border-input bg-transparent shadow-sm text-base md:text-sm
              focus-visible:ring-1 focus-visible:ring-ring` ✓ ⇒ 凡是与本仓观感冲突的**逐条覆盖回来** ✗✓
              （`h-auto` / `rounded-xl` / `border-border/60` / `bg-muted` / `py-2` / `text-sm` /
              `shadow-none`），**视觉与改前逐字一致** ✓；**不加 `focus-visible:ring-0`** ✗ —— `Input` base 的 `focus-visible:ring-1 ring-ring` 与本仓 `globals.css:714-718` 的 `focus:ring-1 ring-primary` **同色同宽** ✓✓ ⇒ 留着才是逐字一致 ✓（口径裁决① ✓）。
              **换来的是本仓原本没有的** `disabled:*` 态 ✓ 与统一的 `file:*` 样式 ✓。 */}
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("sidebar.search")}
            className="h-auto w-full rounded-xl border border-border/60 bg-muted py-2 pl-9 pr-3 text-sm text-foreground shadow-none placeholder:text-muted-foreground transition-colors focus:border-border focus:bg-background focus:outline-none"
          />
        </div>
        {/* ⚠️ 2026-10-09（计划 12 · 相位 4 的范式 ✓）：文字按钮 → `ghost` ✓。
            变体表达不了的差异**逐条覆盖回来** ✗✓ —— 视觉与改前逐字一致 ✓：
            · `h-auto`（ghost 是 h-9 ✓，本仓这颗的高度由 gap 与 py-2 决定 ✓）
            · `px-3 py-2 rounded-xl`（覆盖 base 的 rounded-md ✓）
            · `hover:bg-hover-surface` + `hover:text-primary-text`（ghost 自带 `hover:bg-hover-surface hover:text-accent-foreground` ✗ —— 本仓的 hover 是**表面色**不是强调色 ✓）
            · `disabled:opacity-40 disabled:cursor-not-allowed`（本仓的禁用观感 ✓，与 base 的 `disabled:opacity-50` 不同 ✗）
            · `transition-colors` 与 base 一致 ⇒ 不写 ✓ */}
        <Button
          variant="ghost"
          type="button"
          onClick={handleBatchRestore}
          disabled={selectedIds.size === 0}
          className="h-auto gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-primary-text hover:bg-hover-surface hover:text-primary-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t("sidebar.batchRestore")}
        </Button>
      </div>

      {/* List */}
      <div className="space-y-0.5">
        {filteredSessions.map((session) => {
          const isSelected = selectedIds.has(session.id);
          return (
            <div
              key={session.id}
              onClick={() => toggleSelect(session.id)}
              className={`group rounded-lg px-3 py-2 transition-colors ${
                isSelected ? "bg-primary/10" : "hover:bg-hover-surface"
              }`}
            >
              <div className="flex items-center gap-2">
                {/* 方块复选框：语义（role=checkbox、aria-checked、Space、焦点）由
                    新原语提供。父行仍有 onClick，所以这里必须 stopPropagation ——
                    否则 Radix 的 click 会冒泡到行，行与控件各切一次。 */}
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelect(session.id)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={session.title}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">
                    {session.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {session.archivedAt
                      ? new Date(session.archivedAt).toLocaleDateString()
                      : ""}
                    {session.cwd
                      ? ` · ${session.cwd.split("/").pop() || session.cwd.split("\\").pop()}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestore(session.id);
                        }}
                        aria-label={t("sidebar.restore")}
                        className="h-6 w-6 rounded-lg text-muted-foreground hover:text-primary-text hover:bg-hover-surface"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t("sidebar.restore")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePermanentDelete(session.id);
                        }}
                        aria-label={t("common.delete")}
                        className="h-6 w-6 rounded-lg text-muted-foreground hover:text-destructive hover:bg-hover-surface"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t("common.delete")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="text-sm text-muted-foreground">
        {selectedIds.size > 0
          ? t("sidebar.nSelected", { count: selectedIds.size })
          : `${filteredSessions.length} ${t("sidebar.archivedSessions").toLowerCase()}`}
      </div>
    </div>
  );
}
