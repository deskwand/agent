import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Lock, Plus, Upload } from "lucide-react";
import { Tooltip } from "../Tooltip";
import { useAppStore } from "../../store";
import type { VaultSnapshot } from "../../../shared/vault";
import type { ChatInputAttachedFile } from "../ChatInput";
import { AttachPickerPanel } from "./AttachPickerPanel";
import {
  mapVaultSnapshotItems,
  mapWorkspaceScan,
  pickerItemMimeType,
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

/** 相对路径取 basename。渲染层不引 path 模块，按 `/` 与 `\` 切。 */
function basename(relPath: string): string {
  const parts = relPath.split(/[/\\]/);
  return parts[parts.length - 1] || relPath;
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
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, close]);

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
    const files: ChatInputAttachedFile[] = ids.map((relPath) => ({
      name: basename(relPath),
      // 工作区附件与本地文件一样按绝对路径复制到 .tmp（零拷贝引用是阶段 2）。
      path: `${cwd?.replace(/[/\\]+$/, "")}/${relPath}`,
      size: workspaceItems.find((item) => item.id === relPath)?.size ?? 0,
      type: pickerItemMimeType(relPath),
      source: "workspace",
      dedupeId: relPath,
    }));
    if (files.length > 0) onAddFiles(files);
    closeAndFocusComposer();
  };

  const menuItemClass =
    "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors";

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

      {open && (
        <div
          role="menu"
          aria-label={t("attachMenu.label")}
          className={`absolute left-0 z-30 flex max-h-[60vh] min-h-0 w-64 flex-col rounded-xl border border-border bg-background p-1 shadow-soft ${
            direction === "down"
              ? "top-[calc(100%+8px)]"
              : "bottom-[calc(100%+8px)]"
          }`}
        >
          {view === "menu" && (
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
                className={`${menuItemClass} text-text-primary hover:bg-surface-hover`}
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
                aria-label={
                  workspaceDisabledReason ?? t("attachMenu.workspace")
                }
                onClick={() => {
                  if (workspaceDisabledReason) return;
                  setView("workspace");
                  void loadWorkspace();
                }}
                className={`${menuItemClass} ${
                  workspaceDisabledReason
                    ? "cursor-not-allowed text-text-muted opacity-50"
                    : "text-text-primary hover:bg-surface-hover"
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
                className={`${menuItemClass} ${
                  vaultDisabledReason
                    ? "cursor-not-allowed text-text-muted opacity-50"
                    : "text-text-primary hover:bg-surface-hover"
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
          )}

          {view === "vault" && (
            <AttachPickerPanel
              source="vault"
              items={vaultItems}
              loading={snapshot === null && !vaultError}
              emptyLabel={t("attachPicker.empty.vault")}
              emptyAction={{
                label: t("attachPicker.goToVault"),
                onClick: () => {
                  useAppStore.getState().setActiveView("vault");
                  closeAndFocusComposer();
                },
              }}
              errorLabel={vaultError ? t("attachPicker.error.vault") : undefined}
              onRetry={() => void loadVaultSnapshot()}
              addedKeys={attachedKeys}
              onConfirm={(ids) => void addVaultFiles(ids)}
              onBack={() => setView("menu")}
              onClose={closeAndFocusComposer}
            />
          )}

          {view === "workspace" && (
            <AttachPickerPanel
              source="workspace"
              items={workspaceItems}
              loading={workspaceLoading}
              emptyLabel={t("attachPicker.empty.workspace")}
              noticeLabel={
                workspaceTruncated ? t("attachPicker.truncated") : undefined
              }
              errorLabel={
                workspaceError ? t("attachPicker.error.workspace") : undefined
              }
              onRetry={() => void loadWorkspace()}
              addedKeys={attachedKeys}
              onConfirm={addWorkspaceFiles}
              onBack={() => setView("menu")}
              onClose={closeAndFocusComposer}
            />
          )}
        </div>
      )}
    </div>
  );
}
