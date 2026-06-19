import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { useIPC } from "../hooks/useIPC";
import { X, Sparkles, Zap } from "lucide-react";
import type { Skill } from "../types";
import {
  BUILTIN_COMMANDS,
  type SlashCommand,
  type PluginSlashItems,
} from "../slash-commands";

export interface ChatInputAttachedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
}

export interface ChatInputSubmitData {
  text: string;
  images: Array<{ url: string; base64: string; mediaType: string }>;
  files: ChatInputAttachedFile[];
}

export interface ChatInputHandle {
  clear: () => void;
  focus: () => void;
  setPrompt: (text: string) => void;
  submit: () => void;
  isEmpty: () => boolean;
  selectFiles: () => void;
}

interface ChatInputProps {
  onSubmit: (data: ChatInputSubmitData) => void;
  onCompact?: (instructions?: string) => void;
  onCommand?: (action: string) => void;
  disabled?: boolean;
  placeholder: string;
  cardClassName: string;
  textareaClassName: string;
  bottomSlot: React.ReactNode;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

/** Base Tailwind classes for slash command menu items. */
export const SLASH_MENU_ITEM_BASE_CLASS =
  "w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2";

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      onSubmit,
      onCompact,
      onCommand,
      disabled = false,
      placeholder,
      cardClassName,
      textareaClassName,
      bottomSlot,
      isExpanded = false,
      onToggleExpand,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { isElectron } = useIPC();
    const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

    const [prompt, setPrompt] = useState("");
    const [pastedImages, setPastedImages] = useState<
      Array<{ url: string; base64: string; mediaType: string }>
    >([]);
    const [attachedFiles, setAttachedFiles] = useState<ChatInputAttachedFile[]>(
      [],
    );
    const [isDragging, setIsDragging] = useState(false);

    // --- Slash command menu ---
    const [slashSkills, setSlashSkills] = useState<Skill[]>([]);
    const [pluginSlashItems, setPluginSlashItems] = useState<PluginSlashItems>({
      skills: [],
      commands: [],
    });
    const [showSlashMenu, setShowSlashMenu] = useState(false);
    const [slashFilter, setSlashFilter] = useState("");
    const [slashStartIndex, setSlashStartIndex] = useState(-1);
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const slashMenuRef = useRef<HTMLDivElement>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const slashTriggerRef = useRef(false);
    const selectFilesRef = useRef<() => void>(() => {});
    /** Tracks whether an IME (e.g. Chinese Pinyin) composition is in progress. */
    const isComposingRef = useRef(false);

    // --- Auto-resize textarea ---
    const adjustTextareaHeight = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
      const maxHeight = lineHeight * (isExpanded ? 15 : 6);
      const minHeight = isExpanded ? lineHeight * 5 : 0;
      const rawHeight = Math.min(textarea.scrollHeight, maxHeight);
      const nextHeight = Math.max(rawHeight, minHeight);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [isExpanded]);

    useEffect(() => {
      adjustTextareaHeight();
    }, [prompt, adjustTextareaHeight]);

    // --- Load skills for slash menu ---
    useEffect(() => {
      if (!isElectron || !window.electronAPI?.skills || !showSlashMenu) return;
      window.electronAPI.skills
        .getAll()
        .then((skills: Skill[]) => {
          setSlashSkills(skills.filter((s) => s.enabled));
        })
        .catch(() => {});
      window.electronAPI.plugins
        ?.listSlashItems?.()
        .then((items: PluginSlashItems) => {
          setPluginSlashItems(items ?? { skills: [], commands: [] });
        })
        .catch(() => {});
    }, [isElectron, showSlashMenu]);

    // --- Click outside to close slash menu ---
    useEffect(() => {
      if (!showSlashMenu) return;
      function handleClick(e: MouseEvent) {
        if (
          slashMenuRef.current &&
          !slashMenuRef.current.contains(e.target as Node)
        ) {
          closeSlashMenu();
        }
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [showSlashMenu]);

    // --- Imperative handle ---
    useImperativeHandle(ref, () => ({
      clear() {
        setPrompt("");
        if (textareaRef.current) {
          textareaRef.current.value = "";
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.overflowY = "hidden";
        }
        pastedImages.forEach((img) => URL.revokeObjectURL(img.url));
        setPastedImages([]);
        setAttachedFiles([]);
      },
      focus() {
        textareaRef.current?.focus();
      },
      setPrompt(text: string) {
        setPrompt(text);
        if (textareaRef.current) {
          textareaRef.current.value = text;
        }
        // Trigger height adjustment on next tick
        setTimeout(() => adjustTextareaHeight(), 0);
      },
      submit() {
        // Trigger form submit programmatically
        handleSubmitInternal();
      },
      isEmpty() {
        return (
          !prompt.trim() &&
          pastedImages.length === 0 &&
          attachedFiles.length === 0
        );
      },
      selectFiles() {
        selectFilesRef.current();
      },
    }));

    // --- Image processing helpers ---
    const blobToBase64 = (blob: Blob): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          if (typeof result !== "string") {
            reject(new Error("FileReader result is not a string"));
            return;
          }
          const parts = result.split(",");
          resolve(parts[1] || "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    const resizeImageIfNeeded = async (blob: Blob): Promise<Blob> => {
      const MAX_BLOB_SIZE = 3.75 * 1024 * 1024;
      if (blob.size <= MAX_BLOB_SIZE) return blob;

      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get canvas context"));
            return;
          }

          const scale = Math.sqrt(MAX_BLOB_SIZE / blob.size);
          const quality = 0.9;

          const attemptCompress = (
            currentScale: number,
            currentQuality: number,
          ): Promise<Blob> => {
            canvas.width = Math.floor(img.width * currentScale);
            canvas.height = Math.floor(img.height * currentScale);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            return new Promise((resolveBlob) => {
              canvas.toBlob(
                (compressedBlob) => {
                  if (!compressedBlob) {
                    reject(new Error("Failed to compress image"));
                    return;
                  }
                  if (
                    compressedBlob.size > MAX_BLOB_SIZE &&
                    (currentQuality > 0.5 || currentScale > 0.3)
                  ) {
                    const newQuality = Math.max(0.5, currentQuality - 0.1);
                    const newScale =
                      currentQuality <= 0.5 ? currentScale * 0.9 : currentScale;
                    attemptCompress(newScale, newQuality).then(resolveBlob);
                  } else {
                    resolveBlob(compressedBlob);
                  }
                },
                blob.type || "image/jpeg",
                currentQuality,
              );
            });
          };

          attemptCompress(scale, quality).then(resolve).catch(reject);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Failed to load image"));
        };
        img.src = url;
      });
    };

    // --- Paste handler ---
    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/"),
      );
      if (imageItems.length === 0) return;
      e.preventDefault();

      const newImages: Array<{
        url: string;
        base64: string;
        mediaType: string;
      }> = [];
      for (const item of imageItems) {
        const blob = item.getAsFile();
        if (!blob) continue;
        try {
          const resizedBlob = await resizeImageIfNeeded(blob);
          const base64 = await blobToBase64(resizedBlob);
          const url = URL.createObjectURL(resizedBlob);
          newImages.push({ url, base64, mediaType: resizedBlob.type });
        } catch {
          setGlobalNotice({
            id: `image-paste-failed-${Date.now()}`,
            type: "warning",
            message: t("chat.imageProcessFailed"),
          });
        }
      }
      setPastedImages((prev) => [...prev, ...newImages]);
    };

    // --- Remove handlers ---
    const removeImage = (index: number) => {
      setPastedImages((prev) => {
        const updated = [...prev];
        URL.revokeObjectURL(updated[index].url);
        updated.splice(index, 1);
        return updated;
      });
    };

    const removeFile = (index: number) => {
      setAttachedFiles((prev) => {
        const updated = [...prev];
        updated.splice(index, 1);
        return updated;
      });
    };

    // --- File selection ---
    const handleFileSelect = async () => {
      if (!isElectron || !window.electronAPI) return;
      try {
        const filePaths = await window.electronAPI.selectFiles();
        if (filePaths.length === 0) return;
        const newFiles = filePaths.map((filePath) => {
          const fileName = filePath.split(/[/\\]/).pop() || "unknown";
          return {
            name: fileName,
            path: filePath,
            size: 0,
            type: "application/octet-stream",
          };
        });
        setAttachedFiles((prev) => [...prev, ...newFiles]);
      } catch (error) {
        console.error("[ChatInput] Error selecting files:", error);
      }
    };

    selectFilesRef.current = handleFileSelect;

    // --- Slash menu helpers ---
    type SlashItem =
      | { category: "command"; command: SlashCommand }
      | { category: "skill"; skill: { name: string; description?: string } }
      | {
          category: "pluginCommand";
          command: { name: string; label: string; description: string };
        };

    const filterText = slashFilter.toLowerCase();
    const filteredCommands = slashFilter
      ? BUILTIN_COMMANDS.filter(
          (c) =>
            c.name.toLowerCase().includes(filterText) ||
            c.description.toLowerCase().includes(filterText),
        )
      : BUILTIN_COMMANDS;
    // Merge own skills + plugin skills into one unified "/skill:name" list.
    // All skills use the same syntax; pi SDK's _expandSkillCommand handles expansion.
    const seenSkillNames = new Set<string>();
    const mergedSkills: { name: string; description?: string }[] = [];
    for (const s of slashSkills) {
      if (seenSkillNames.has(s.name)) continue;
      seenSkillNames.add(s.name);
      mergedSkills.push({ name: s.name, description: s.description });
    }
    for (const s of pluginSlashItems.skills) {
      if (seenSkillNames.has(s.name)) continue;
      seenSkillNames.add(s.name);
      mergedSkills.push({ name: s.name, description: s.description });
    }

    const filteredSkills = slashFilter
      ? mergedSkills.filter(
          (s) =>
            s.name.toLowerCase().includes(filterText) ||
            (s.description || "").toLowerCase().includes(filterText),
        )
      : mergedSkills;

    const filteredPluginCommands = slashFilter
      ? pluginSlashItems.commands.filter(
          (c) =>
            c.name.toLowerCase().includes(filterText) ||
            c.description.toLowerCase().includes(filterText),
        )
      : pluginSlashItems.commands;

    const filteredItems: SlashItem[] = useMemo(
      () => [
        ...filteredCommands.map((c) => ({
          category: "command" as const,
          command: c,
        })),
        ...filteredPluginCommands.map((c) => ({
          category: "pluginCommand" as const,
          command: c,
        })),
        ...filteredSkills.map((s) => ({
          category: "skill" as const,
          skill: s,
        })),
      ],
      [filteredCommands, filteredPluginCommands, filteredSkills],
    );

    const hasCommands = filteredCommands.length > 0;
    const hasSkills = filteredSkills.length > 0;
    const hasPluginCommands = filteredPluginCommands.length > 0;

    const closeSlashMenu = useCallback(() => {
      setShowSlashMenu(false);
      setSlashFilter("");
      setSlashStartIndex(-1);
      setSlashSelectedIndex(0);
    }, []);

    const clearSlashText = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea || slashStartIndex < 0) return;
      const currentValue = textarea.value;
      const cursorPos = textarea.selectionStart;
      const before = currentValue.slice(0, slashStartIndex);
      const after = currentValue.slice(cursorPos);
      const newValue = before + after;
      setPrompt(newValue);
      textarea.value = newValue;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(slashStartIndex, slashStartIndex);
      });
    }, [slashStartIndex]);

    const selectSlashItem = useCallback(
      (item: SlashItem) => {
        if (item.category === "command") {
          onCommand?.(item.command.action);
          clearSlashText();
          closeSlashMenu();
          return;
        }
        // skill or pluginCommand: insert text
        const textarea = textareaRef.current;
        if (!textarea || slashStartIndex < 0) return;
        const currentValue = textarea.value;
        const cursorPos = textarea.selectionStart;
        const before = currentValue.slice(0, slashStartIndex);
        const after = currentValue.slice(cursorPos);
        let replacement: string;
        if (item.category === "pluginCommand") {
          replacement = `/${item.command.name} `;
        } else {
          // category === "skill" — all skills use /skill:name syntax
          replacement = `/skill:${item.skill.name} `;
        }
        const newValue = before + replacement + after;
        setPrompt(newValue);
        textarea.value = newValue;
        closeSlashMenu();
        const newCursorPos = slashStartIndex + replacement.length;
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        });
      },
      [slashStartIndex, closeSlashMenu, clearSlashText, onCommand],
    );

    // --- Drag and drop ---
    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };
    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      const otherFiles = files.filter(
        (file) => !file.type.startsWith("image/"),
      );

      if (imageFiles.length > 0) {
        const newImages: Array<{
          url: string;
          base64: string;
          mediaType: string;
        }> = [];
        for (const file of imageFiles) {
          try {
            const resizedBlob = await resizeImageIfNeeded(file);
            const base64 = await blobToBase64(resizedBlob);
            const url = URL.createObjectURL(resizedBlob);
            newImages.push({ url, base64, mediaType: resizedBlob.type });
          } catch {
            setGlobalNotice({
              id: `image-drop-failed-${Date.now()}`,
              type: "warning",
              message: t("chat.imageProcessFailed"),
            });
          }
        }
        setPastedImages((prev) => [...prev, ...newImages]);
      }

      if (otherFiles.length > 0) {
        const newFiles = await Promise.all(
          otherFiles.map(async (file) => {
            const droppedPath =
              "path" in file && typeof file.path === "string" ? file.path : "";
            const inlineDataBase64 = droppedPath
              ? undefined
              : await blobToBase64(file);
            return {
              name: file.name,
              path: droppedPath,
              size: file.size,
              type: file.type || "application/octet-stream",
              inlineDataBase64,
            };
          }),
        );
        setAttachedFiles((prev) => [...prev, ...newFiles]);
      }
    };

    // --- Submit ---
    const handleSubmitInternal = useCallback(() => {
      const currentPrompt = textareaRef.current?.value || prompt;
      if (
        !currentPrompt.trim() &&
        pastedImages.length === 0 &&
        attachedFiles.length === 0
      )
        return;
      if (disabled) return;

      // --- /compact command interception ---
      if (currentPrompt.startsWith("/compact")) {
        const instructions =
          currentPrompt.slice("/compact".length).trim() || undefined;
        onCompact?.(instructions);
        setPrompt("");
        if (textareaRef.current) {
          textareaRef.current.value = "";
          textareaRef.current.style.height = "auto";
        }
        return;
      }
      // --- end /compact ---

      // Collapse back after submit if expanded
      if (isExpanded) {
        onToggleExpand?.();
      }

      onSubmit({
        text: currentPrompt.trim(),
        images: pastedImages,
        files: attachedFiles,
      });
    }, [prompt, pastedImages, attachedFiles, disabled, onSubmit, onCompact, isExpanded, onToggleExpand]);

    const handleFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      handleSubmitInternal();
    };

    return (
      <form
        onSubmit={handleFormSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative w-full"
      >
        {/* Image previews */}
        {pastedImages.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
            {pastedImages.map((img, index) => (
              <div
                key={img.url || `pasted-image-${index}`}
                className="relative group"
              >
                <img
                  src={img.url}
                  alt={t("common.pastedImageAlt", { index: index + 1 })}
                  className="w-full aspect-square object-cover rounded-lg border border-border block"
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* File attachments */}
        {attachedFiles.length > 0 && (
          <div className="space-y-2 mb-3">
            {attachedFiles.map((file, index) => (
              <div
                key={file.path || `attached-file-${index}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary truncate">
                    {file.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="w-6 h-6 rounded-full bg-error/10 hover:bg-error/20 text-error flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input card wrapper — keeps slash menu outside card div so space-y-* doesn't add margin to textarea */}
        <div className="relative">
          {/* Slash command menu — outside the card to avoid space-y-4 pushing textarea down */}
          {showSlashMenu && filteredItems.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute left-0 right-0 bottom-[calc(100%+6px)] z-30 max-h-48 overflow-y-auto rounded-xl border border-border bg-background shadow-soft p-1"
            >
              {hasCommands && (
                <>
                  <div className="px-2.5 py-1.5 text-sm text-text-muted font-medium">
                    {t("chat.slashCommands")}
                  </div>
                  {filteredCommands.map((cmd, idx) => {
                    const globalIdx = idx; // commands come first
                    return (
                      <button
                        key={`cmd:${cmd.name}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSlashItem({
                            category: "command",
                            command: cmd,
                          });
                        }}
                        className={`${SLASH_MENU_ITEM_BASE_CLASS} ${
                          globalIdx === slashSelectedIndex
                            ? "bg-accent/10 text-accent"
                            : "text-text-primary hover:bg-surface-hover"
                        }`}
                      >
                        <Zap className="w-4 h-4 flex-shrink-0 text-accent" />
                        <span className="flex-1 truncate">/{cmd.name}</span>
                        <span className="text-sm text-text-muted truncate max-w-[12rem] hidden sm:inline">
                          {cmd.description}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
              {hasCommands && hasPluginCommands && (
                <div className="mx-2 my-1 border-t border-border" />
              )}
              {hasPluginCommands && (
                <>
                  <div className="px-2.5 py-1.5 text-sm text-text-muted font-medium">
                    {t("chat.slashPluginCommands")}
                  </div>
                  {filteredPluginCommands.map((cmd, idx) => {
                    const globalIdx = filteredCommands.length + idx;
                    return (
                      <button
                        key={`plugin-cmd:${cmd.name}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSlashItem({
                            category: "pluginCommand",
                            command: cmd,
                          });
                        }}
                        className={`${SLASH_MENU_ITEM_BASE_CLASS} ${
                          globalIdx === slashSelectedIndex
                            ? "bg-accent/10 text-accent"
                            : "text-text-primary hover:bg-surface-hover"
                        }`}
                      >
                        <Zap className="w-4 h-4 flex-shrink-0 text-accent" />
                        <span className="flex-1 truncate">/{cmd.name}</span>
                        <span className="text-sm text-text-muted truncate max-w-[12rem] hidden sm:inline">
                          {cmd.description}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
              {(hasCommands || hasPluginCommands) && hasSkills && (
                <div className="mx-2 my-1 border-t border-border" />
              )}
              {hasSkills && (
                <>
                  <div className="px-2.5 py-1.5 text-sm text-text-muted font-medium">
                    {t("chat.slashSkills")}
                  </div>
                  {filteredSkills.map((skill, idx) => {
                    const globalIdx =
                      filteredCommands.length +
                      filteredPluginCommands.length +
                      idx;
                    return (
                      <button
                        key={`skill:${skill.name}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSlashItem({ category: "skill", skill });
                        }}
                        className={`${SLASH_MENU_ITEM_BASE_CLASS} ${
                          globalIdx === slashSelectedIndex
                            ? "bg-accent/10 text-accent"
                            : "text-text-primary hover:bg-surface-hover"
                        }`}
                      >
                        <Sparkles className="w-4 h-4 flex-shrink-0 text-text-muted" />
                        <span className="flex-1 truncate">
                          /skill:{skill.name}
                        </span>
                        {skill.description && (
                          <span className="text-sm text-text-muted truncate max-w-[12rem] hidden sm:inline">
                            {skill.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
          {/* Input card */}
          <div
            className={`transition-colors ${isDragging ? "ring-2 ring-accent bg-accent/5" : ""} ${cardClassName}`}
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                const newValue = e.target.value;
                const textarea = textareaRef.current;
                const isComposing = isComposingRef.current;

                // Slash menu trigger: onKeyDown sets slashTriggerRef when '/' is pressed
                if (slashTriggerRef.current) {
                  slashTriggerRef.current = false;
                  if (textarea) {
                    const cursorPos = textarea.selectionStart;
                    const charBefore =
                      cursorPos > 1 ? newValue[cursorPos - 2] : "";
                    // Trigger only at start of input or after space, and not after another /
                    if (
                      (cursorPos <= 1 ||
                        charBefore === " " ||
                        charBefore === "\n") &&
                      charBefore !== "/"
                    ) {
                      setSlashStartIndex(cursorPos - 1);
                      setSlashFilter("");
                      setSlashSelectedIndex(0);
                      setShowSlashMenu(true);
                    }
                  }
                }

                // Filter while slash menu is open.
                // During IME composition, selectionStart is locked to the
                // composition-range start; use selectionEnd to include the
                // composed (pinyin) text so filtering works in real time.
                if (showSlashMenu && textarea) {
                  const endPos = isComposing
                    ? textarea.selectionEnd
                    : textarea.selectionStart;
                  const query = newValue.slice(slashStartIndex + 1, endPos);
                  if (
                    !isComposing &&
                    (query.includes(" ") || query.includes("\n"))
                  ) {
                    closeSlashMenu();
                  } else {
                    setSlashFilter(query);
                    setSlashSelectedIndex(0);
                  }
                }

                // Detect if / was deleted → close menu.
                // Skip this check during composition — selectionStart is
                // locked to the composition start and may falsely trigger.
                if (showSlashMenu && textarea && !isComposing) {
                  if (textarea.selectionStart <= slashStartIndex) {
                    closeSlashMenu();
                  }
                }

                setPrompt(newValue);
              }}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className={textareaClassName}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
                // onChange fires after compositionend with correct
                // selectionStart, so no explicit re-filter needed here.
              }}
              onKeyDown={(e) => {
                // Detect '/' key for slash menu trigger (before any state check)
                if (
                  e.key === "/" &&
                  !isComposingRef.current &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  !e.altKey
                ) {
                  slashTriggerRef.current = true;
                }

                // Slash menu keyboard nav
                if (showSlashMenu && filteredItems.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashSelectedIndex((prev) =>
                      Math.min(prev + 1, filteredItems.length - 1),
                    );
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashSelectedIndex((prev) => Math.max(prev - 1, 0));
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (filteredItems[slashSelectedIndex]) {
                      selectSlashItem(filteredItems[slashSelectedIndex]);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeSlashMenu();
                    return;
                  }
                  // Any other key that's not the slash filter → let onChange handle it
                }

                // Esc collapses expanded input (outside slash menu)
                if (e.key === "Escape" && isExpanded) {
                  e.preventDefault();
                  onToggleExpand?.();
                  return;
                }

                if (e.key === "Enter" && !e.shiftKey) {
                  // Block Enter during IME composition (e.g. pinyin → Chinese).
                  if (isComposingRef.current || e.keyCode === 229) return;
                  // Expanded mode: Enter = newline, only submit on Cmd/Ctrl+Enter
                  if (isExpanded) {
                    if (!e.metaKey && !e.ctrlKey) return;
                    e.preventDefault();
                    handleSubmitInternal();
                    return;
                  }
                  e.preventDefault();
                  handleSubmitInternal();
                }
              }}
            />
            {bottomSlot}
          </div>
        </div>
      </form>
    );
  },
);
