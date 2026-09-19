import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  FileText,
  FolderOpen,
  Lock,
  Pencil,
  Plus,
  Target,
  Trash2,
  Upload,
} from "lucide-react";
import { Tooltip } from "../Tooltip";
import { useAppStore } from "../../store";
import type { VaultSnapshot } from "../../../shared/vault";
import type { PromptCommandSaveError } from "../../../shared/ipc-types";
import type { ChatInputAttachedFile } from "../ChatInput";
import {
  MENU_BADGE_CLASS,
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_DISABLED_CLASS,
  MENU_LABEL_CLASS,
  MENU_PANEL_PADDED_CLASS,
  MENU_SEPARATOR_CLASS,
} from "../menu-styles";
import { ConfirmDialog } from "../ConfirmDialog";
import { AttachPickerModal } from "./AttachPickerModal";
import { AttachPickerPanel } from "./AttachPickerPanel";
import {
  PromptCommandFormModal,
  type PromptCommandFormValue,
} from "./PromptCommandFormModal";
import {
  mapVaultSnapshotItems,
  mapWorkspaceScan,
  pickerItemMimeType,
  splitRelPath,
  type AttachPickerItem,
} from "./picker-items";

type PanelView = "menu" | "vault" | "workspace";

export interface AttachMenuProps {
  /** 当前会话工作目录；缺省表示还没有会话，工作区入口置灰 */
  cwd?: string;
  /** 「上传本地文件」：复用系统文件框 */
  onPickLocalFiles: () => void;
  /** 选择器确认后的结果 */
  onAddFiles: (files: ChatInputAttachedFile[]) => void;
  /** 已在输入框里的附件身份 key（`attachmentKey()` 的产物） */
  attachedKeys: ReadonlySet<string>;
  /** 展开方向，跟随输入框的 slashMenuDirection */
  direction?: "up" | "down";
  /** 确认/取消后回调：宿主在这里把焦点交回输入框 */
  onDismiss?: () => void;
  /**
   * 命令入口：compact 立即执行；goal 插入命令 chip（落点由宿主决定）。
   * 缺省 = 本宿主没有命令能力（欢迎页），内置两项不渲染。
   */
  onCommandEntry?: (command: "compact" | "goal") => void;
  /**
   * 自定义命令入口：宿主把 /名字 chip 插进输入框。
   * 它与 onCommandEntry 共同决定「本宿主有没有命令能力」—— 两个都不传时
   * 「命令」组整组不渲染（欢迎页旧行为由 attach-menu.test.ts 锁着）。
   */
  onInsertPromptCommand?: (name: string) => void;
}

/**
 * 「命令」组里的一行。显示名来自模板 frontmatter 的 display_name；
 * 列表只收 source === "prompt" && editable（自己写的）那些。
 */
interface PromptRow {
  name: string;
  displayName?: string;
}

/** 自定义命令行：行内按钮与整行按钮之间的间距（整行按钮自带 px-2.5）。 */
const PROMPT_ROW_GAP_CLASS = "gap-0.5";

export function AttachMenu({
  cwd,
  onPickLocalFiles,
  onAddFiles,
  attachedKeys,
  direction = "up",
  onDismiss,
  onCommandEntry,
  onInsertPromptCommand,
}: AttachMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("menu");
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [vaultError, setVaultError] = useState(false);
  const [workspaceItems, setWorkspaceItems] = useState<AttachPickerItem[]>([]);
  const [workspaceTruncated, setWorkspaceTruncated] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState(false);
  // 弹窗的选择状态：弹窗外壳要用它渲染计数与「添加」的禁用态，
  // 所以由这里（数据和确认动作的拥有者）持有，面板只是受控渲染。
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [promptRows, setPromptRows] = useState<PromptRow[]>([]);
  const [promptRowsFailed, setPromptRowsFailed] = useState(false);
  const [formInitial, setFormInitial] = useState<PromptCommandFormValue | null>(null);
  const [formIsCreate, setFormIsCreate] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [formNameError, setFormNameError] = useState<PromptCommandSaveError | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const loadVaultSnapshot = useCallback(async () => {
    try {
      const next = await window.electronAPI.vault.getSnapshot();
      setSnapshot(next);
      setVaultError(false);
    } catch {
      setVaultError(true);
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!cwd) return;
    setWorkspaceLoading(true);
    setWorkspaceError(false);
    try {
      const result = await window.electronAPI.scanWorkspaceFiles(cwd);
      setWorkspaceItems(mapWorkspaceScan(result.files));
      setWorkspaceTruncated(result.truncated);
    } catch {
      setWorkspaceError(true);
      setWorkspaceItems([]);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [cwd]);

  /**
   * 命令列表与斜杠菜单同源（commands.list）。这里只取自己写的那些：
   * source === "prompt" && editable —— 项目级 / 插件包带来的模板不在「+」里出现，
   * 因为那不是「我的命令」，也不该从这里删。
   */
  const loadPromptCommands = useCallback(async () => {
    if (!onInsertPromptCommand || !window.electronAPI?.piCommands?.list) {
      setPromptRows([]);
      return;
    }
    try {
      const dto = await window.electronAPI.piCommands.list(cwd);
      setPromptRows(
        dto.commands
          .filter((cmd) => cmd.source === "prompt" && cmd.editable)
          .map((cmd) => ({ name: cmd.name, displayName: cmd.displayName })),
      );
      setPromptRowsFailed(false);
    } catch {
      setPromptRows([]);
      setPromptRowsFailed(true);
    }
  }, [cwd, onInsertPromptCommand]);

  // 快照只在菜单打开时拉一次：输入框常驻挂载时不做任何密库请求。
  const openMenu = () => {
    setOpen(true);
    setView("menu");
    // 唯一的重置点：弹窗没有「返回菜单」，换来源必然走「关掉 → 再点 +」。
    setSelectedIds([]);
    void loadVaultSnapshot();
    void loadPromptCommands();
  };

  const close = useCallback(() => {
    setOpen(false);
    setView("menu");
  }, []);

  // 确认/取消后把焦点交回输入框（spec §3.3）。点击浮层外不抢焦点：
  // 那种情况下用户点的目标元素自己会拿到焦点。
  const closeAndFocusComposer = useCallback(() => {
    close();
    onDismiss?.();
  }, [close, onDismiss]);

  const runCommandEntry = (command: "compact" | "goal") => {
    // 顺序不变量：先执行命令，再关菜单交回焦点。insertCommandChip 的文末光标落在
    // requestAnimationFrame 里，反过来的话会被 onDismiss 的 focus() 覆盖掉。
    onCommandEntry?.(command);
    closeAndFocusComposer();
  };

  const runPromptEntry = (name: string) => {
    // 顺序不变量同上：先插 chip，再关菜单交回焦点。
    onInsertPromptCommand?.(name);
    closeAndFocusComposer();
  };

  const openCreateForm = () => {
    setFormNameError(null);
    setFormIsCreate(true);
    setFormInitial({ name: "", displayName: "", content: "" });
  };

  /**
   * 编辑要读正文，所以走 prompts.get（列表里不带 content）。
   * 读不到（文件在别处被删了）就不开表单 —— 开个空表单再保存等于新建，
   * 那是用户没要求的行为。
   */
  const openEditForm = async (name: string) => {
    const dto = await window.electronAPI?.promptCommands?.get(name);
    if (!dto) {
      setPromptRowsFailed(true);
      return;
    }
    setFormNameError(null);
    setFormIsCreate(false);
    setFormInitial({
      name: dto.name,
      displayName: dto.displayName ?? "",
      content: dto.content ?? "",
    });
  };

  const submitForm = async (value: PromptCommandFormValue) => {
    setFormSaving(true);
    try {
      const result = await window.electronAPI?.promptCommands?.save(
        {
          name: value.name.trim(),
          displayName: value.displayName.trim() || undefined,
          content: value.content,
        },
        formIsCreate,
      );
      if (result && !result.ok) {
        setFormNameError(result.error);
        return;
      }
      setFormInitial(null);
      await loadPromptCommands();
      // 斜杠菜单与 chip 由 main 写盘后广播的 commands.changed 刷新
    } finally {
      setFormSaving(false);
    }
  };

  const confirmDelete = async () => {
    const name = pendingDelete;
    setPendingDelete(null);
    if (!name) return;
    const result = await window.electronAPI?.promptCommands?.delete(name);
    if (result && !result.ok) {
      useAppStore.getState().setGlobalNotice({
        id: `prompt-delete-failed-${Date.now()}`,
        type: "warning",
        message: t("chat.commandDeleteFailed"),
      });
      return;
    }
    await loadPromptCommands();
  };

  useEffect(() => {
    // 只在菜单层生效：选择器弹窗与表单弹窗都是 portal 到 document.body 的，
    // 天然在 rootRef 之外，不加这道守卫的话「在弹窗里点第一下」就会把 open 置回 false。
    // 表单弹窗的 view 仍是 "menu"，所以还得额外看 formInitial —— 否则在表单里
    // 敲字/点输入框都会把「+」菜单关掉，保存后就回不到命令组（设计文档 §4.5
    // 要求保存后菜单不关，方便连续建几条）。
    if (!open || view !== "menu" || formInitial !== null) return;
    function handleClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, view, close, formInitial]);

  // 菜单项可访问名：置灰时说明原因，可用时就是动作名。
  const vaultDisabledReason = vaultError
    ? null
    : !snapshot
      ? null // 尚未拿到快照：先按可用渲染，进入面板后再按真实状态显示
      : !snapshot.hasLocalMek
        ? t("attachMenu.disabled.vaultNotSet")
        : snapshot.operationStatus !== "idle"
          ? t("attachMenu.disabled.vaultBusy")
          : null;

  const workspaceDisabledReason = cwd
    ? null
    : t("attachMenu.disabled.noWorkspace");

  const vaultItems = useMemo(
    () => (snapshot ? mapVaultSnapshotItems(snapshot.items) : []),
    [snapshot],
  );

  const addVaultFiles = async (ids: string[]) => {
    const files: ChatInputAttachedFile[] = [];
    for (const name of ids) {
      const item = vaultItems.find((candidate) => candidate.id === name);
      try {
        const path = await window.electronAPI.vault.getFilePath(name);
        files.push({
          name,
          path,
          size: item?.size ?? 0,
          type: pickerItemMimeType(name),
          source: "vault",
          dedupeId: name,
        });
      } catch {
        // 单个文件在快照与确认之间被删除：跳过它，其余照常添加
      }
    }
    if (files.length > 0) onAddFiles(files);
    closeAndFocusComposer();
  };

  const addWorkspaceFiles = (ids: string[]) => {
    const files: ChatInputAttachedFile[] = ids.map((relPath) => {
      const { name } = splitRelPath(relPath);
      return {
        name,
        // 工作区附件与本地文件一样按绝对路径复制到 .tmp（零拷贝引用是阶段 2）。
        path: `${cwd?.replace(/[/\\]+$/, "")}/${relPath}`,
        size: workspaceItems.find((item) => item.id === relPath)?.size ?? 0,
        type: pickerItemMimeType(name),
        source: "workspace",
        dedupeId: relPath,
      };
    });
    if (files.length > 0) onAddFiles(files);
    closeAndFocusComposer();
  };

  const pickerCount =
    view === "vault" ? vaultItems.length : workspaceItems.length;
  const pickerLoading =
    view === "vault" ? snapshot === null && !vaultError : workspaceLoading;
  const pickerFailed = view === "vault" ? vaultError : workspaceError;
  // 计数只在「已加载、没出错、也没被截断」时显示：否则会出现「0 个文件」
  // 配着「读取失败」或「可能未覆盖全部」，两处说法互相矛盾。
  const showPickerCount =
    !pickerLoading &&
    !pickerFailed &&
    !(view === "workspace" && workspaceTruncated);
  const pickerSubtitle =
    view === "vault"
      ? showPickerCount
        ? t("attachPicker.fileCount", { count: pickerCount })
        : ""
      : [
          showPickerCount
            ? t("attachPicker.fileCount", { count: pickerCount })
            : null,
          cwd,
        ]
          .filter(Boolean)
          .join(" · ");

  // 菜单层键盘路径：打开时焦点进第一项，↑/↓ 在项间移动，Esc 关闭并还给触发器。
  // 焦点在菜单项上时，Enter/Space 由按钮自身的 click 处理，不需要额外拦键盘，
  // 也不会误触触发器上的 Enter。
  useEffect(() => {
    if (open && view === "menu") itemRefs.current[0]?.focus();
  }, [open, view]);

  const moveMenuFocus = (delta: number) => {
    const items = itemRefs.current.filter(
      (element): element is HTMLButtonElement => element !== null,
    );
    if (items.length === 0) return;
    const current = items.findIndex(
      (element) => element === document.activeElement,
    );
    const base = current < 0 ? 0 : current;
    items[(base + delta + items.length) % items.length]?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocusComposer();
      return;
    }
    if (
      view === "menu" &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      moveMenuFocus(event.key === "ArrowDown" ? 1 : -1);
    }
  };

  return (
    <div className="relative" ref={rootRef} onKeyDown={handleMenuKeyDown}>
      <Tooltip label={t("attachMenu.label")}>
        <button
          type="button"
          data-attach-trigger
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("attachMenu.label")}
          onClick={() => (open ? close() : openMenu())}
          className="flex h-9 w-9 items-center justify-center rounded-2xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <Plus className="h-4 w-4" />
        </button>
      </Tooltip>

      {open && view === "menu" && (
        <div
          role="menu"
          aria-label={t("attachMenu.label")}
          className={`${MENU_PANEL_PADDED_CLASS} absolute left-0 z-30 flex max-h-[60vh] min-h-0 w-64 flex-col ${
            direction === "down"
              ? "top-[calc(100%+8px)] animate-menu-in-down"
              : "bottom-[calc(100%+8px)] animate-menu-in-up"
          }`}
        >
          <>
            <button
              type="button"
              role="menuitem"
              ref={(element) => {
                itemRefs.current[0] = element;
              }}
              onClick={() => {
                onPickLocalFiles();
                closeAndFocusComposer();
              }}
              className={`${MENU_ITEM_CLASS} ${MENU_ITEM_DEFAULT_CLASS}`}
            >
              <Upload className="h-4 w-4 shrink-0 text-text-muted" />
              {t("attachMenu.localFile")}
            </button>

            <button
              type="button"
              role="menuitem"
              ref={(element) => {
                itemRefs.current[1] = element;
              }}
              aria-disabled={Boolean(workspaceDisabledReason)}
              aria-label={workspaceDisabledReason ?? t("attachMenu.workspace")}
              onClick={() => {
                if (workspaceDisabledReason) return;
                setView("workspace");
                void loadWorkspace();
              }}
              className={`${MENU_ITEM_CLASS} ${
                workspaceDisabledReason
                  ? MENU_ITEM_DISABLED_CLASS
                  : MENU_ITEM_DEFAULT_CLASS
              }`}
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate">
                {t("attachMenu.workspace")}
              </span>
              {workspaceDisabledReason && (
                <span className="shrink-0 text-xs">
                  {workspaceDisabledReason}
                </span>
              )}
            </button>

            <button
              type="button"
              role="menuitem"
              ref={(element) => {
                itemRefs.current[2] = element;
              }}
              aria-disabled={Boolean(vaultDisabledReason)}
              aria-label={vaultDisabledReason ?? t("attachMenu.vault")}
              onClick={() => {
                if (vaultDisabledReason) return;
                setView("vault");
              }}
              className={`${MENU_ITEM_CLASS} ${
                vaultDisabledReason
                  ? MENU_ITEM_DISABLED_CLASS
                  : MENU_ITEM_DEFAULT_CLASS
              }`}
            >
              <Lock className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate">
                {t("attachMenu.vault")}
              </span>
              {vaultDisabledReason && (
                <span className="shrink-0 text-xs">{vaultDisabledReason}</span>
              )}
            </button>

            {(onCommandEntry || onInsertPromptCommand) && (
              <>
                <div className={MENU_SEPARATOR_CLASS} />
                <div className="flex items-center justify-between pr-1">
                  <div className={MENU_LABEL_CLASS}>
                    {t("chat.slashCommands")}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    data-command-create
                    aria-label={t("chat.newCommand")}
                    ref={(element) => {
                      itemRefs.current[3] = element;
                    }}
                    onClick={openCreateForm}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {onCommandEntry && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      ref={(element) => {
                        itemRefs.current[4] = element;
                      }}
                      onClick={() => runCommandEntry("compact")}
                      className={`${MENU_ITEM_CLASS} ${MENU_ITEM_DEFAULT_CLASS}`}
                    >
                      <Archive className="h-4 w-4 shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        {t("slash.compact")}
                      </span>
                      <span className={MENU_BADGE_CLASS}>
                        {t("skillMarket.sourceBuiltin")}
                      </span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      ref={(element) => {
                        itemRefs.current[5] = element;
                      }}
                      onClick={() => runCommandEntry("goal")}
                      className={`${MENU_ITEM_CLASS} ${MENU_ITEM_DEFAULT_CLASS}`}
                    >
                      <Target className="h-4 w-4 shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        {t("slash.goal")}
                      </span>
                      <span className={MENU_BADGE_CLASS}>
                        {t("skillMarket.sourceBuiltin")}
                      </span>
                    </button>
                  </>
                )}

                {promptRows.map((row, index) => (
                  <div
                    key={row.name}
                    className={`group flex items-center ${PROMPT_ROW_GAP_CLASS}`}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      ref={(element) => {
                        itemRefs.current[6 + index] = element;
                      }}
                      onClick={() => runPromptEntry(row.name)}
                      className={`${MENU_ITEM_CLASS} ${MENU_ITEM_DEFAULT_CLASS} min-w-0 flex-1`}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        {row.displayName || row.name}
                      </span>
                      <span className={`${MENU_BADGE_CLASS} group-hover:hidden`}>
                        {t("skillMarket.sourceCustom")}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-command-edit={row.name}
                      aria-label={t("common.edit")}
                      onClick={() => void openEditForm(row.name)}
                      className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary group-hover:flex group-focus-within:flex"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-command-delete={row.name}
                      aria-label={t("common.delete")}
                      onClick={() => setPendingDelete(row.name)}
                      className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-error/10 hover:text-error group-hover:flex group-focus-within:flex"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {promptRowsFailed && (
                  <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-text-muted">
                    <span className="min-w-0 flex-1 truncate">
                      {t("chat.commandLoadFailed")}
                    </span>
                    <button
                      type="button"
                      data-command-retry
                      onClick={() => void loadPromptCommands()}
                      className="shrink-0 underline"
                    >
                      {t("chat.commandRetry")}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        </div>
      )}

      {open && (view === "vault" || view === "workspace") && (
        <AttachPickerModal
          source={view}
          subtitle={pickerSubtitle}
          selectedCount={selectedIds.length}
          onClose={closeAndFocusComposer}
          onConfirm={() => {
            // 不要在这里再 close 一次：addVaultFiles / addWorkspaceFiles
            // 内部已经调了 closeAndFocusComposer()。
            if (view === "vault") void addVaultFiles(selectedIds);
            else addWorkspaceFiles(selectedIds);
          }}
        >
          <AttachPickerPanel
            source={view}
            items={view === "vault" ? vaultItems : workspaceItems}
            loading={pickerLoading}
            emptyLabel={
              view === "vault"
                ? t("attachPicker.empty.vault")
                : t("attachPicker.empty.workspace")
            }
            emptyAction={
              view === "vault"
                ? {
                    label: t("attachPicker.goToVault"),
                    onClick: () => {
                      useAppStore.getState().setActiveView("vault");
                      closeAndFocusComposer();
                    },
                  }
                : undefined
            }
            noticeLabel={
              view === "workspace" && workspaceTruncated
                ? t("attachPicker.truncated")
                : undefined
            }
            errorLabel={
              view === "vault"
                ? vaultError
                  ? t("attachPicker.error.vault")
                  : undefined
                : workspaceError
                  ? t("attachPicker.error.workspace")
                  : undefined
            }
            onRetry={() =>
              void (view === "vault" ? loadVaultSnapshot() : loadWorkspace())
            }
            addedKeys={attachedKeys}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onClose={closeAndFocusComposer}
            onConfirm={(ids) => {
              if (view === "vault") void addVaultFiles(ids);
              else addWorkspaceFiles(ids);
            }}
          />
        </AttachPickerModal>
      )}

      {formInitial && (
        <PromptCommandFormModal
          mode={formIsCreate ? "create" : "edit"}
          initial={formInitial}
          nameError={formNameError}
          saving={formSaving}
          onSave={(value) => void submitForm(value)}
          onClose={() => setFormInitial(null)}
        />
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={t("chat.commandDeleteConfirm", { name: pendingDelete ?? "" })}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
