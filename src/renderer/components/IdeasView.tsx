import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Ellipsis,
  Lightbulb,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { selectVisibleIdeas, useAppStore } from "../store";
import { captureShortcutLabel } from "../utils/capture-shortcut-label";
import { formatAppDateTime } from "../utils/i18n-format";
import { Button } from "./app-button";
import { Toggle } from "./ui/toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { MessageMarkdown } from "./MessageMarkdown";

/** 打字时自动保存的静默期；失焦、⌘↵、切条目都会立刻冲刷掉它。 */
const AUTOSAVE_DEBOUNCE_MS = 1000;

type SaveState = "idle" | "saving" | "saved" | "failed" | "stale" | "gone";

/** 保存状态**带着它属于哪一条**：否则 A 的迟到结果会画到 B 的状态行上。 */
interface SaveStatus {
  name: string | null;
  state: SaveState;
}

/**
 * 一次编辑的**归属快照**（H2）：进入编辑那一刻就把 `name` 与 `mtimeMs` 定下来。
 * 保存只认这个快照 —— 不看当时的 `selected`，也不依赖"blur 先于 click"的事件顺序。
 */
interface EditSession {
  name: string;
  mtimeMs: number;
  text: string;
}

/**
 * 灵感视图：左列表 + 右详情，**没有底栏**。
 *
 * 三条与 v1 不同的取舍（都是"少一步"）：
 *  1. **归档不是另一个列表**：只有一个列表，未归档在前，已归档按右上角开关决定要不要
 *     附在后面。「收件箱 / 归档」那套叫法整个不存在。
 *  2. **没有编辑按钮、没有编辑态**：正文点一下就地变输入框，失焦即存（打字时 1 秒防抖），
 *     `⌘↵` 立刻存，`Esc` 只退出不存。状态就近报在正文下方。
 *  3. **动作在详情头部**：`交给 AI`（唯一主操作）与 `⋯`（刷新 / 归档·恢复 / 删除）跟着
 *     元数据那一行走，正文再长也不用滚到底部找按钮。
 *
 * 刷新不进界面：进视图、窗口重新获得焦点各自动拉一次，`⌘R` 与 `⋯` 各留一份 —— 想法是
 * 明文 md 文件，应用之外（编辑器、agent）都可能改它，这个能力必须留着。
 */
export function IdeasView(): JSX.Element {
  const { t } = useTranslation();
  const ideasInbox = useAppStore((s) => s.ideasInbox);
  const ideasArchived = useAppStore((s) => s.ideasArchived);
  const ideasSkipped = useAppStore((s) => s.ideasSkipped);
  const showArchivedIdeas = useAppStore((s) => s.showArchivedIdeas);
  const ideasSelectedName = useAppStore((s) => s.ideasSelectedName);
  const ideasLoading = useAppStore((s) => s.ideasLoading);
  const ideasError = useAppStore((s) => s.ideasError);
  const sessions = useAppStore((s) => s.sessions);
  const setShowArchivedIdeas = useAppStore((s) => s.setShowArchivedIdeas);
  const selectIdea = useAppStore((s) => s.selectIdea);
  const loadIdeas = useAppStore((s) => s.loadIdeas);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const startNewSession = useAppStore((s) => s.startNewSession);
  const setPendingEditorAppend = useAppStore((s) => s.setPendingEditorAppend);
  const openIdeaCapture = useAppStore((s) => s.openIdeaCapture);

  const visible = useMemo(
    () => selectVisibleIdeas({ showArchivedIdeas, ideasInbox, ideasArchived }),
    [showArchivedIdeas, ideasInbox, ideasArchived],
  );
  const selected =
    visible.find((idea) => idea.name === ideasSelectedName) ?? null;
  // H1：正文读取只认**名字**。`loadIdeas()` 每次从 IPC 拿回新数组 ⇒ `find()` 产出新对象，
  // 依赖对象身份会让读取 effect 在「窗口重新获得焦点」「⌘R」「保存后自己调的那次 loadIdeas」
  // 上重跑 —— 而重跑要给编辑中的草稿让路（见下面的 effect）。
  const selectedName = selected?.name ?? null;

  const [body, setBody] = useState("");
  const [session, setSession] = useState<EditSession | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({
    name: null,
    state: "idle",
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [processingOpen, setProcessingOpen] = useState(false);
  /**
   * ⋯ 触发按钮的 ref：菜单退场时的回焦目标（Radix 默认回它，确认框那条路径显式用它）。
   * 不要改用「打开时聚焦的元素」—— 那在菜单项上，菜单一关就随 portal 卸载。
   */
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** 菜单项正要打开删除确认：退场时不许菜单把焦点抢回 Trigger（让确认框接管）。 */
  const openingConfirmRef = useRef(false);
  /**
   * 确认框退场后的回焦目标。菜单入口记为 ⋯ 触发器（菜单项届时已随 portal 卸载，
   * Radix 默认的「回打开时聚焦的元素」会落到空处）；行内 hover 入口不记 ——
   * 那颗键一直在 DOM 里，默认回焦就是对的。
   */
  const confirmReturnFocusRef = useRef<HTMLElement | null>(null);
  /** 待确认删除的那一条：行内 hover 与 ⋯ 菜单都走它，护栏只有一处。 */
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(
    null,
  );

  const mtimeRef = useRef(0);
  /** 当前 `body` 属于哪一条 —— 迟到的读、迟到的保存都靠它判断能不能落进正文槽。 */
  const bodyNameRef = useRef<string | null>(null);
  /** 同一条的在飞写盘：串行化，避免两次写盘用同一个 mtime 基线（第二次会报假的"外部修改"）。 */
  const savingRef = useRef<Promise<void> | null>(null);
  const debounceRef = useRef<number | null>(null);
  /**
   * H3：命中过 IDEA_STALE 的条目名。锁住期间不再自动保存，直到显式刷新。
   *
   * 既当锁（`staleLockRef`，给异步回调读）又当告警源（`staleName`，给渲染读）——
   * 少了后者，用户一按 Esc 或继续打字就会把红字擦掉，而锁还挂着：**"没在保存"变成静默的**。
   */
  const [staleName, setStaleName] = useState<string | null>(null);
  const staleLockRef = useRef<string | null>(null);
  // 给计时器与异步回调读最新值（它们的闭包早于最新一次渲染）。
  const sessionRef = useRef<EditSession | null>(null);
  sessionRef.current = session;
  const bodyRef = useRef(body);
  bodyRef.current = body;

  /** 这一条此刻还是选中项吗 —— 用 store 的实时值判，不用渲染时的快照。 */
  const isSelected = useCallback(
    (name: string) => useAppStore.getState().ideasSelectedName === name,
    [],
  );

  const clearDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  /**
   * 确认框退场后把焦点还给菜单触发器。共享的 ConfirmDialog 不带返回目标 API（本任务不改它），
   * 且 Radix 自己的退场回焦也是延迟任务 ⇒ 用两跳定时器排在它之后。
   */
  const restoreConfirmFocus = useCallback(() => {
    const target = confirmReturnFocusRef.current;
    confirmReturnFocusRef.current = null;
    if (!target) return;
    window.setTimeout(() => {
      window.setTimeout(() => {
        if (target.isConnected) target.focus({ preventScroll: true });
      }, 0);
    }, 0);
  }, []);

  /** 读盘。显式刷新与"选中项变了"共用它。 */
  const readBody = useCallback(
    async (name: string) => {
      const payload = await window.electronAPI.ideas.read(name);
      // 迟到的读不许落进正文槽：用户可能已经切走（两次 read 会乱序回来），
      // 落进去就会变成"拿 A 的正文去编辑 B"，保存时报的是假的"外部修改"。
      if (!isSelected(name)) return;
      setBody(payload.body);
      bodyNameRef.current = name;
      mtimeRef.current = payload.mtimeMs;
    },
    [isSelected],
  );

  const persist = useCallback(
    async (target: EditSession, keepEditing: boolean) => {
      // H3：锁住之后不再自动保存（否则防抖会一轮轮失败、刷屏，而用户以为自己存上了）。
      if (staleLockRef.current === target.name) return;
      const previous = savingRef.current;
      const run = (async () => {
        // 同一条的写盘串行化：⌘↵ 之后紧接着失焦会排第二次写，若两次共用同一个 mtime
        // 基线，第二次必然撞 IDEA_STALE —— 报出假的"文件已在外部被修改"。
        if (previous) await previous.catch(() => undefined);
        if (target.text === bodyRef.current) {
          setSaveStatus({ name: target.name, state: "saved" });
          return;
        }
        // 基线在**写之前**取：会话还开着就用会话里（可能刚被上一次保存续过）的值。
        const baseline =
          sessionRef.current?.name === target.name
            ? sessionRef.current.mtimeMs
            : target.mtimeMs;
        setSaveStatus({ name: target.name, state: "saving" });
        try {
          const next = await window.electronAPI.ideas.update(target.name, {
            content: target.text,
            mtimeMs: baseline,
          });
          // 迟到的保存不许污染当前这条：用户可能已经切走了。
          if (isSelected(target.name)) {
            setBody(target.text);
            bodyNameRef.current = target.name;
            // 基线每次落盘后都要续上：失焦存过一次、再点进正文改，下一次若还用旧 mtime
            // 就会报出假的「文件已在外部被修改」。
            mtimeRef.current = next.mtimeMs;
          }
          // 只有"还在编辑这条"时才把会话接着开下去 —— 失焦/切条目已经把它关了，
          // 这里不许把它复活（否则一会车就把输入框又弹出来）。
          if (keepEditing && sessionRef.current?.name === target.name) {
            setSession({ ...sessionRef.current, mtimeMs: next.mtimeMs });
          }
          setSaveStatus({ name: target.name, state: "saved" });
          void loadIdeas();
        } catch (error) {
          const message = String(error);
          if (
            !message.includes("IDEA_NOT_FOUND") &&
            isSelected(target.name) &&
            sessionRef.current?.name !== target.name
          ) {
            // 失败时不许把这段输入从界面上抹掉：失焦那一路已经关了会话，这里把它放回来，
            // 让用户看得见、改得动、也点得动"重试"。
            setSession(target);
            sessionRef.current = target;
          }
          if (message.includes("IDEA_NOT_FOUND")) {
            // 文件在应用之外被删了：重试永远不会成功，说清它没了，并回到列表。
            setSession(null);
            sessionRef.current = null;
            setSaveStatus({ name: target.name, state: "gone" });
            void loadIdeas();
          } else if (message.includes("IDEA_STALE")) {
            staleLockRef.current = target.name;
            setStaleName(target.name);
            setSaveStatus({ name: target.name, state: "stale" });
          } else {
            setSaveStatus({ name: target.name, state: "failed" });
          }
        }
      })();
      savingRef.current = run;
      await run;
    },
    [loadIdeas, isSelected],
  );

  useEffect(() => {
    void loadIdeas();
    const onFocus = () => void loadIdeas();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadIdeas]);

  useEffect(() => {
    clearDebounce();
    setMenuOpen(false);
    setProcessingOpen(false);
    if (!selectedName) {
      setSession(null);
      sessionRef.current = null;
      setBody("");
      bodyNameRef.current = null;
      setSaveStatus({ name: null, state: "idle" });
      return;
    }
    // H1：正在编辑这一条时，重读不许把草稿冲掉 —— 列表刷新（窗口获得焦点、⌘R、
    // 保存后的重拉）都会走到这里，而用户的草稿只存在 session 里。
    if (sessionRef.current?.name === selectedName) return;
    // 切走时**先冲刷**：选中项可能被 store 的回落逻辑换掉（例如正在编辑的那条被外部
    // 归档、或列表刷新后它不在可见范围里），直接丢会话就是静默丢一段输入。
    const outgoing = sessionRef.current;
    if (outgoing) void persist(outgoing, false);
    setSession(null);
    sessionRef.current = null;
    setSaveStatus({ name: selectedName, state: "idle" });
    let cancelled = false;
    void readBody(selectedName).catch(() => {
      // 文件被应用之外删了（设计接受的场景）：退回列表，别把界面挂死。
      if (cancelled) return;
      setBody("");
      bodyNameRef.current = null;
      void loadIdeas();
    });
    return () => {
      cancelled = true;
    };
  }, [selectedName, loadIdeas, readBody, clearDebounce, persist]);

  // 卸载时既要清计时器，也要把这段草稿送出去：⌘Q、程序化切视图都不会触发 blur，
  // 光清计时器等于把最后 1 秒的输入丢掉。
  useEffect(
    () => () => {
      clearDebounce();
      const current = sessionRef.current;
      sessionRef.current = null;
      if (current) void persist(current, false);
    },
    [clearDebounce, persist],
  );

  // ⌘R 刷新：不进界面，但要是条真能走通的路。
  const reload = useCallback(() => {
    staleLockRef.current = null;
    setStaleName(null);
    setSession(null);
    sessionRef.current = null;
    setSaveStatus({ name: selectedName, state: "idle" });
    void loadIdeas();
    if (selectedName) {
      void readBody(selectedName).catch(() => {
        setBody("");
        bodyNameRef.current = null;
      });
    }
  }, [loadIdeas, readBody, selectedName]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        reload();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reload]);

  /**
   * 落盘一次。`session` 是进入编辑时定下的归属（H2），保存过程中续上新的 `mtimeMs`，
   * 否则第二次自动保存必然撞 IDEA_STALE。
   */
  const schedule = useCallback(
    (target: EditSession) => {
      clearDebounce();
      if (staleLockRef.current === target.name) return;
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        const current = sessionRef.current;
        if (current?.name === target.name) void persist(current, true);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [clearDebounce, persist],
  );

  /** 把当前这段编辑立刻存下去；`close` = 同时退出编辑（失焦、切条目时用）。 */
  const commit = useCallback(
    (close: boolean) => {
      clearDebounce();
      const current = sessionRef.current;
      if (close) {
        setSession(null);
        // 显式清掉：不把"关掉之后不会被复活"这件事寄托在 React 的调度顺序上。
        sessionRef.current = null;
      }
      if (current) void persist(current, !close);
    },
    [clearDebounce, persist],
  );

  /** 进入就地编辑。正文还没加载到这一条时不许进 —— 否则会话会带着上一条的 text/mtime。 */
  const beginEdit = useCallback(() => {
    if (!selectedName || bodyNameRef.current !== selectedName) return;
    setSaveStatus({ name: selectedName, state: "idle" });
    setSession({
      name: selectedName,
      mtimeMs: mtimeRef.current,
      text: bodyRef.current,
    });
  }, [selectedName]);

  const move = useCallback(
    (delta: number) => {
      const index = visible.findIndex(
        (idea) => idea.name === ideasSelectedName,
      );
      const next =
        visible[Math.min(Math.max(index + delta, 0), visible.length - 1)];
      // 已经在两端时不动，也就别顺手把编辑关掉（否则按到边界会莫名退出编辑）。
      if (next && next.name !== ideasSelectedName) {
        commit(true);
        selectIdea(next.name);
      }
    },
    [visible, ideasSelectedName, selectIdea, commit],
  );

  const sourceTitle = (sessionId: string | null): string | null => {
    if (!sessionId) return null;
    return sessions.find((session) => session.id === sessionId)?.title ?? null;
  };
  const sourceLabel = (sessionId: string | null): string =>
    sourceTitle(sessionId) ??
    (sessionId ? t("ideas.sourceDeleted") : t("ideas.sourceNone"));

  const handOff = (mode: "new" | "current") => {
    if (!selected) return;
    setProcessingOpen(false);
    // 只是把正文填进输入框，不自动发送：你多半要先补一句「把这个做成…」。
    if (mode === "new") startNewSession();
    setPendingEditorAppend((session?.text ?? body) || selected.excerpt);
    setActiveView("chat");
  };

  /** 归档/删除前先把这条存了：否则并发的两次写盘会互相踩 mtime。 */
  const flushBeforeMutation = async (name: string) => {
    const current = sessionRef.current;
    if (current?.name === name) {
      setSession(null);
      await persist(current, false);
    }
  };

  const setStatus = async (name: string, status: "inbox" | "archived") => {
    setMenuOpen(false);
    setProcessingOpen(false);
    await flushBeforeMutation(name);
    try {
      await window.electronAPI.ideas.setStatus(name, status);
    } finally {
      void loadIdeas();
    }
  };

  const remove = async (name: string) => {
    setMenuOpen(false);
    setSession(null);
    sessionRef.current = null;
    try {
      await window.electronAPI.ideas.remove(name);
    } catch {
      // 文件本来就没了：当作已删。
    } finally {
      void loadIdeas();
    }
  };

  const openSource = () => {
    if (!selected?.sourceSessionId) return;
    setActiveSession(selected.sourceSessionId);
    setActiveView("chat");
  };

  const editing = session !== null && session.name === selectedName;

  // 保存状态只认**属于当前这条**的那些 —— A 的迟到结果不许画到 B 的状态行上。
  const saveState: SaveState =
    saveStatus.name === selectedName ? saveStatus.state : "idle";
  const hasUnsavedEdits = editing && session.text !== body;
  const statusText =
    staleName === selectedName
      ? t("ideas.staleHint")
      : saveState === "saving"
        ? t("ideas.saving")
        : saveState === "saved"
          ? t("ideas.saved")
          : saveState === "stale"
            ? t("ideas.staleHint")
            : saveState === "gone"
              ? t("ideas.gone")
              : saveState === "failed"
                ? t("ideas.saveFailed")
                : hasUnsavedEdits
                  ? // 防抖窗口里也算"保存中"：一敲字就该有反馈，而不是空白一秒。
                    t("ideas.saving")
                  : editing
                    ? ""
                    : t("ideas.editHint");

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          {/* 返回与密库页/应用页同一颗键、同一套类名（既有约定，不另发明）。 */}
          <button
            type="button"
            onClick={() => setActiveView("chat")}
            aria-label={t("common.back")}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <h1 className="text-xl font-semibold text-foreground">
            {t("ideas.title")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* 页面内的新增入口。
              在这之前，"再记一条"只有两条路：⌘⇧K，或者去悬停左栏那颗 rail 图标等卡片 ——
              **两条都在页面之外**，人已经站在这一页上了反而找不到地方加（2026-10-11 用户报障）。
              **列表空的时候它也还在**，所以空态不至于只剩一句 ⌘⇧K 教学。

              **形状照抄密库页头部那几颗图标键**（同步 / ⋯ / 高级）：普通 button + `h-9 w-9
              rounded-2xl text-muted-foreground hover:bg-accent` + `Tooltip side="bottom"`，
              16px 图标。理由有二：
                1. 那套是这个应用**页头动作的既有语言** —— 页头里从来不放带字的按钮；
                2. 一屏里两颗带字的按钮（这把 ＋ 与详情区的「交给 AI」）会互相抢，
                   右上角就成了一片"两行四颗、形状各异"（用户 2026-10-11 原话：「太乱太杂」）。
              键位提示因此从按钮里挪进 tooltip：以前那行 `⌘⇧K` 让按钮宽了一倍，
              而空态里还会再教一次，不必把字摆在页头上。 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="ideas-add"
                aria-label={t("ideas.addWithShortcut", {
                  keys: captureShortcutLabel(window.electronAPI?.platform),
                })}
                onClick={openIdeaCapture}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("ideas.addWithShortcut", {
                keys: captureShortcutLabel(window.electronAPI?.platform),
              })}
            </TooltipContent>
          </Tooltip>
          {/* 二态筛选走官方 Toggle（皮肤来自 ui/toggle.tsx，别在调用点手写 aria-pressed 与条件类）。 */}
          <Toggle
            pressed={showArchivedIdeas}
            onPressedChange={setShowArchivedIdeas}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
          >
            {t("ideas.showArchived", { count: ideasArchived.length })}
            <ChevronDown className="h-3.5 w-3.5" />
          </Toggle>
        </div>
      </header>

      {ideasSkipped > 0 ? (
        <p className="mx-5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t("ideas.skipped", { count: ideasSkipped })}
        </p>
      ) : null}
      {ideasError ? (
        <p className="mx-5 rounded-md border border-destructive/50 px-3 py-2 text-xs text-destructive">
          {t("ideas.loadFailed")}
          <span className="ml-2 text-muted-foreground">{ideasError}</span>
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 border-t border-border">
        {visible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
            <div>
              <Lightbulb className="mx-auto mb-3 h-6 w-6" />
              <h2 className="mb-1 text-sm font-semibold text-foreground">
                {t("ideas.emptyTitle")}
              </h2>
              <p className="text-xs">
                {t("ideas.emptyHint", {
                  keys: captureShortcutLabel(window.electronAPI?.platform),
                })}
              </p>
            </div>
          </div>
        ) : (
          <>
            <ul
              role="listbox"
              aria-label={t("ideas.title")}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(-1);
                }
              }}
              className="flex w-[322px] shrink-0 flex-col gap-0.5 overflow-auto border-r border-border p-2"
            >
              {visible.map((idea, index) => (
                <li key={idea.name}>
                  {showArchivedIdeas && index === ideasInbox.length ? (
                    <p className="px-2.5 pb-1 pt-2 text-[11px] text-muted-foreground">
                      {t("ideas.archivedGroup")}
                    </p>
                  ) : null}
                  {/* 行是 div 不是 button：里面还有两个按钮，嵌套 button 是非法 HTML。 */}
                  <div
                    role="option"
                    aria-selected={idea.name === ideasSelectedName}
                    tabIndex={-1}
                    onClick={() => {
                      if (idea.name !== ideasSelectedName) commit(true);
                      selectIdea(idea.name);
                    }}
                    className={`group flex items-start gap-1.5 rounded-md px-2.5 py-2 ${
                      idea.name === ideasSelectedName
                        ? "bg-accent"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <span
                        className={`line-clamp-2 text-[12.5px] ${
                          idea.status === "archived" ? "opacity-60" : ""
                        }`}
                      >
                        {idea.excerpt}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="shrink-0">
                          {formatAppDateTime(idea.createdAt)}
                        </span>
                        <span className="truncate">
                          {sourceLabel(idea.sourceSessionId)}
                        </span>
                      </span>
                    </div>
                    {/* hover 才浮出；tabIndex=-1 让它只服务鼠标 —— 键盘用户走详情区的
                        ⋯ 菜单，否则列表里会多出 2N 个 Tab 停留点。 */}
                    <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={t(
                          idea.status === "inbox"
                            ? "ideas.archiveNamed"
                            : "ideas.restoreNamed",
                          { name: idea.excerpt },
                        )}
                        className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                        onClick={(event) => {
                          event.stopPropagation();
                          void setStatus(
                            idea.name,
                            idea.status === "inbox" ? "archived" : "inbox",
                          );
                        }}
                      >
                        {idea.status === "inbox" ? (
                          <Archive className="h-3.5 w-3.5" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={t("ideas.removeNamed", {
                          name: idea.excerpt,
                        })}
                        className="grid h-6 w-6 place-items-center rounded-md text-destructive hover:bg-accent"
                        onClick={(event) => {
                          event.stopPropagation();
                          // 行内入口：回焦目标不记（Radix 的默认值就是这颗键）
                          confirmReturnFocusRef.current = null;
                          setPendingDeleteName(idea.name);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex min-w-0 flex-1 flex-col">
              {selected ? (
                <>
                  <div className="flex items-center gap-2 px-5 py-3">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">
                        {formatAppDateTime(selected.createdAt)}
                      </span>
                      <span>·</span>
                      {sourceTitle(selected.sourceSessionId) ? (
                        <button
                          type="button"
                          className="truncate text-primary-text underline"
                          onClick={openSource}
                        >
                          {sourceLabel(selected.sourceSessionId)}
                        </button>
                      ) : (
                        <span className="truncate">
                          {sourceLabel(selected.sourceSessionId)}
                        </span>
                      )}
                    </span>
                    <span className="flex-1" />

                    <div className="relative">
                      <DropdownMenu
                        open={processingOpen}
                        // 单一来源：打开就关掉另一个（保留原互斥关系）；
                        // 不再有 onClick toggle，click 不会再叠加一次开关。
                        onOpenChange={(open) => {
                          setProcessingOpen(open);
                          if (open) setMenuOpen(false);
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button>
                            <Plus className="h-3.5 w-3.5" />
                            {t("ideas.handOff")}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            className="text-xs"
                            onSelect={() => handOff("new")}
                          >
                            {t("ideas.handOffNew")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-xs"
                            onSelect={() => handOff("current")}
                          >
                            {t("ideas.handOffCurrent")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="relative">
                      <DropdownMenu
                        open={menuOpen}
                        onOpenChange={(open) => {
                          setMenuOpen(open);
                          if (open) setProcessingOpen(false);
                        }}
                      >
                        <DropdownMenuTrigger asChild ref={moreTriggerRef}>
                          <Button
                            variant="ghost"
                            aria-label={t("ideas.moreActions")}
                            className="px-2"
                          >
                            <Ellipsis className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-40"
                          onCloseAutoFocus={(event) => {
                            // 正要开删除确认：退场不许把焦点抢回 Trigger，
                            // 否则 modal 的确认框会把它再弹回去（一次无意义抢焦）。
                            if (openingConfirmRef.current) {
                              openingConfirmRef.current = false;
                              event.preventDefault();
                            }
                          }}
                        >
                          <DropdownMenuItem
                            disabled={ideasLoading}
                            data-testid="ideas-refresh"
                            className="text-xs"
                            onSelect={() => reload()}
                          >
                            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                            {t("ideas.refresh")}
                          </DropdownMenuItem>
                          {selected.status === "inbox" ? (
                            <DropdownMenuItem
                              className="text-xs"
                              onSelect={() =>
                                void setStatus(selected.name, "archived")
                              }
                            >
                              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                              {t("ideas.archive")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-xs"
                              onSelect={() =>
                                void setStatus(selected.name, "inbox")
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                              {t("ideas.restore")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-xs text-destructive focus:text-destructive"
                            onSelect={() => {
                              // 删除不能直达：先开确认框（护栏仍只有一处）
                              openingConfirmRef.current = true;
                              confirmReturnFocusRef.current =
                                moreTriggerRef.current;
                              setPendingDeleteName(selected.name);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("ideas.remove")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* 整块正文区域都是编辑入口：点哪里都能开始改，不用先瞄准文字。 */}
                  <div className="min-h-0 flex-1 overflow-auto px-5">
                    {editing && session ? (
                      <textarea
                        autoFocus
                        value={session.text}
                        aria-label={t("ideas.bodyLabel")}
                        onChange={(event) => {
                          const next = { ...session, text: event.target.value };
                          setSession(next);
                          // 「已保存」到下一次打字为止：这里显式回到 idle，
                          // 剩下的由 hasUnsavedEdits 推导成「保存中…」。
                          setSaveStatus({ name: next.name, state: "idle" });
                          schedule(next);
                        }}
                        onBlur={() => commit(true)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            // Esc 只退出，不存。
                            event.preventDefault();
                            clearDebounce();
                            setSession(null);
                            sessionRef.current = null;
                            setSaveStatus({
                              name: selectedName,
                              state: "idle",
                            });
                            return;
                          }
                          if (
                            event.key === "Enter" &&
                            (event.metaKey || event.ctrlKey)
                          ) {
                            event.preventDefault();
                            clearDebounce();
                            void persist(session, true);
                          }
                        }}
                        className="min-h-full w-full resize-none border-0 bg-transparent py-1 text-sm outline-none"
                      />
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={t("ideas.editHint")}
                        data-testid="ideas-body"
                        className="min-h-full cursor-text py-1"
                        onClick={beginEdit}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            beginEdit();
                          }
                        }}
                      >
                        <MessageMarkdown normalizedText={body} />
                      </div>
                    )}
                  </div>

                  {saveState === "failed" && session ? (
                    // 文案里写着"重试"，那就得真能点。
                    <button
                      type="button"
                      data-testid="ideas-save-state"
                      className="px-5 pb-3 text-left text-[11px] text-destructive"
                      onClick={() => void persist(session, true)}
                    >
                      {statusText}
                    </button>
                  ) : (
                    <p
                      data-testid="ideas-save-state"
                      className={`px-5 pb-3 text-[11px] ${
                        saveState === "stale" ||
                        saveState === "failed" ||
                        saveState === "gone"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {statusText || "\u00A0"}
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingDeleteName !== null}
        title={t("ideas.removeConfirmTitle")}
        description={t("ideas.removeConfirmBody")}
        onCancel={() => {
          setPendingDeleteName(null);
          restoreConfirmFocus();
        }}
        onConfirm={() => {
          const name = pendingDeleteName;
          setPendingDeleteName(null);
          restoreConfirmFocus();
          if (name) void remove(name);
        }}
      />
    </section>
  );
}
