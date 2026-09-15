import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Lock, Plus, Upload } from "lucide-react";
import { Tooltip } from "../Tooltip";
import { useAppStore } from "../../store";
import type { VaultSnapshot } from "../../../shared/vault";
import type { ChatInputAttachedFile } from "../ChatInput";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_DISABLED_CLASS,
  MENU_PANEL_PADDED_CLASS,
} from "../menu-styles";
import { AttachPickerModal } from "./AttachPickerModal";
import { AttachPickerPanel } from "./AttachPickerPanel";
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
}

export function AttachMenu({
  cwd,
  onPickLocalFiles,
  onAddFiles,
  attachedKeys,
  direction = "up",
  onDismiss,
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

  // 快照只在菜单打开时拉一次：输入框常驻挂载时不做任何密库请求。
  const openMenu = () => {
    setOpen(true);
    setView("menu");
    // 唯一的重置点：弹窗没有「返回菜单」，换来源必然走「关掉 → 再点 +」。
    setSelectedIds([]);
    void loadVaultSnapshot();
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

  useEffect(() => {
    // 只在菜单层生效：选择器弹窗是 portal 到 document.body 的，天然在 rootRef
    // 之外，不加这道守卫的话「在弹窗里点第一下」就会把 open 置回 false。
    if (!open || view !== "menu") return;
    function handleClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, view, close]);

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
    </div>
  );
}
