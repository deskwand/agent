import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { FolderOpen, Search, SquarePen } from "lucide-react";
import { useAppStore } from "../store";
import { useIPC } from "../hooks/useIPC";
import { shortcutPlatform } from "../voice-shortcut-labels";
import { useOpenSession } from "../hooks/useOpenSession";
import { searchSessions } from "../utils/session-search";
import { OccludingDialog } from "./ui/occluding-dialog";
import { DialogOverlay, DialogPortal } from "./ui/dialog";

/** 键盘提示里的修饰键：macOS 给 ⌘，其它平台给 Ctrl+（平台归一化走共享实现）。 */
const MOD_LABEL =
  shortcutPlatform(
    typeof window !== "undefined" ? window.electronAPI?.platform : undefined,
  ) === "mac"
    ? "⌘"
    : "Ctrl+";

const KEY_PILL_CLASS =
  "shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground";
const SECTION_LABEL_CLASS =
  "px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground";

/**
 * 会话搜索弹窗（⌘K）。
 *
 * 从侧栏顶部那颗放大镜或快捷键打开：上半是「聊天」结果，下半是「快捷操作」。
 * 每行右端的 ⌘1–⌘9 **就是**真能按的键位（见 `searchSessions` 的 9 条上限），
 * 不做「看起来能按、按了没反应」的装饰。
 *
 * 打开一条会话走 `useOpenSession`：它负责预载历史，和侧栏点击是同一条序列 ——
 * 少这一步，切过去会停在「正在加载历史」。
 */
export function SessionSearchPalette() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.sessionSearchOpen);
  const closeSearch = useAppStore((s) => s.closeSessionSearch);
  const sessions = useAppStore((s) => s.sessions);
  const workingDir = useAppStore((s) => s.workingDir);
  const setWorkingDir = useAppStore((s) => s.setWorkingDir);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const startNewSession = useAppStore((s) => s.startNewSession);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const { changeWorkingDir } = useIPC();
  const openSession = useOpenSession();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => searchSessions(sessions, query),
    [sessions, query],
  );
  // 结果变少时把高亮夹回范围内：否则 ↑↓ 的起点会落在一条不存在的行上。
  const safeIndex =
    results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  // 每次打开都从空白输入、第一行开始 —— 关掉再开不该看见上一次的关键字。
  // 必须是 layout effect：`useEffect` 在 paint 之后跑，会先闪一帧上一次的搜索结果。
  useLayoutEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (safeIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-search-index="${safeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  const handleSelect = useCallback(
    async (sessionId: string) => {
      closeSearch();
      setActiveView("chat");
      const opened = await openSession(sessionId);
      // 预载失败时弹窗已经关了，什么都不说就等于「点了没反应」。
      if (!opened) {
        setGlobalNotice({
          id: `notice-session-open-failed-${Date.now()}`,
          type: "error",
          message: t("sidebar.openSessionFailed"),
        });
      }
    },
    [closeSearch, openSession, setActiveView, setGlobalNotice, t],
  );

  const handleNewChat = useCallback(() => {
    closeSearch();
    startNewSession();
  }, [closeSearch, startNewSession]);

  // 与侧栏「打开已有项目」同一个流程：选目录 → 落成 workingDir → 新会话。
  const handleOpenFolder = useCallback(async () => {
    closeSearch();
    const result = await changeWorkingDir(undefined, workingDir || undefined);
    if (!result?.success) return;
    setWorkingDir(result.path);
    setActiveView("chat");
    setActiveSession(null);
  }, [
    changeWorkingDir,
    closeSearch,
    setActiveSession,
    setActiveView,
    setWorkingDir,
    workingDir,
  ]);

  const moveActive = (delta: number) => {
    if (results.length === 0) return;
    const base = safeIndex < 0 ? 0 : safeIndex;
    setActiveIndex((base + delta + results.length) % results.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // 中文输入法正在组字：回车/方向键属于输入法，不归我们。
    if (event.nativeEvent.isComposing) return;

    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (digit) {
        event.preventDefault();
        const match = results[Number(digit) - 1];
        if (match) void handleSelect(match.session.id);
        return;
      }
      if (event.code === "KeyN") {
        event.preventDefault();
        handleNewChat();
        return;
      }
      if (event.code === "KeyO") {
        event.preventDefault();
        void handleOpenFolder();
        return;
      }
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const match = results[safeIndex];
      if (match) void handleSelect(match.session.id);
    }
  };

  return (
    <OccludingDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSearch();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={handleKeyDown}
          className="fixed left-1/2 top-[8vh] z-50 flex max-h-[70vh] w-[524px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-foreground shadow-elevated"
        >
          <DialogPrimitive.Title className="sr-only">
            {t("sidebar.searchChat")}
          </DialogPrimitive.Title>

          {/* 输入行：放大镜 + 无边框输入框。**下面不要分隔线** —— 输入框与列表同属
              一块浮层，一条横线会把「搜索框 + 结果」切成两个盒子（效果图里也没有）。 */}
          <div className="flex items-center gap-2.5 px-4 py-3.5">
            <Search
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              placeholder={t("sidebar.searchChat")}
              aria-label={t("sidebar.searchChat")}
              role="combobox"
              aria-expanded="true"
              aria-controls="session-search-results"
              aria-autocomplete="list"
              aria-activedescendant={
                safeIndex >= 0
                  ? `session-search-option-${safeIndex}`
                  : undefined
              }
              // `focus:ring-0`：globals.css 的 input 焦点规则会画 1px 主题色环
              //（浅色主题下就是个黑框）。弹窗里不需要那圈环 —— 焦点由
              //「弹窗已打开 + 光标在框里」传达。能覆盖得动，靠那条规则用 `:where()`
              // 把 `:not()` 链的特异性清零；否则它的 0,6,1 会赢过 0,2,0 的 utility。
              className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            />
          </div>

          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-1 pt-2"
          >
            <div className={SECTION_LABEL_CLASS}>
              {t("searchPalette.chats")}
            </div>

            {results.length === 0 ? (
              <div className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                {t("searchPalette.empty")}
              </div>
            ) : (
              <div
                id="session-search-results"
                role="listbox"
                aria-label={t("searchPalette.chats")}
              >
                {results.map((match, index) => (
                  <div
                    key={match.session.id}
                    id={`session-search-option-${index}`}
                    role="option"
                    aria-selected={index === safeIndex}
                    data-search-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void handleSelect(match.session.id)}
                    className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm ${
                      index === safeIndex ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {match.session.title}
                    </span>
                    {match.projectName && (
                      <span className="max-w-[7rem] shrink-0 truncate text-xs text-muted-foreground">
                        {match.projectName}
                      </span>
                    )}
                    <kbd className={KEY_PILL_CLASS}>
                      {MOD_LABEL}
                      {index + 1}
                    </kbd>
                  </div>
                ))}
              </div>
            )}

            <div className={SECTION_LABEL_CLASS}>
              {t("searchPalette.quickActions")}
            </div>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-accent/50"
            >
              <SquarePen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">
                {t("sidebar.newChat")}
              </span>
              <kbd className={KEY_PILL_CLASS}>{MOD_LABEL}N</kbd>
            </button>
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-accent/50"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">
                {t("searchPalette.openFolder")}
              </span>
              <kbd className={KEY_PILL_CLASS}>{MOD_LABEL}O</kbd>
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </OccludingDialog>
  );
}
