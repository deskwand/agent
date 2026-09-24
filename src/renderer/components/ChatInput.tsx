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
import { useCurrentSession } from "../store/selectors";
import { useIPC } from "../hooks/useIPC";
import { stripLeadingSkillToken } from "../utils/reference-tokens";
import { attachmentKey, mergeAttachedFiles } from "../utils/attached-files";
import {
  degradeNonLeadingTokens,
  getCaretOffset,
  placeCaretAtEnd,
  serializeEditor,
  setEditorFromText,
} from "../utils/editor-content";
import { AttachmentTiles, type AttachmentTile } from "./attach/AttachmentTiles";
import type { ImageSource } from "./ImageLightbox";
import type { Skill } from "../types";
import {
  filterCommands,
  getBuiltinCommands,
  mergeSlashCommands,
  toSlashCommands,
  type SlashCommand,
  type SlashItem,
} from "../slash-commands";
import { SlashMenu, type SlashTab } from "./SlashMenu";
import {
  loadSlashRecency,
  saveSlashRecency,
  sortByRecency,
} from "../slash-recency";
import { loadPinnedSkills, togglePinnedSkill } from "../pinned-skills";
import { compressImageForLLM } from "../utils/image-compress";
import type { ElementSelection } from "../../shared/ipc-types";
import {
  addElementSelection,
  removeElementSelection,
  selectionKey,
} from "../utils/element-selections";
import {
  DRAFT_SCHEMA_VERSION,
  EMPTY_DRAFT,
  readDraft,
  removeDraft,
  writeDraft,
  type ChatDraft,
} from "../utils/chat-draft-store";

export interface ChatInputAttachedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
  /** 来源：缺省视为本地文件（系统文件框 / 拖拽） */
  source?: "local" | "vault" | "workspace";
  /** 选择器给出的稳定身份（密库=文件名、工作区=相对路径）；仅用于去重与「已添加」标记 */
  dedupeId?: string;
}

export interface ChatInputSubmitData {
  text: string;
  images: Array<{ url: string; base64: string; mediaType: string }>;
  files: ChatInputAttachedFile[];
  /** 浏览器元素拾取的磁贴快照；带元素的消息允许文本为空 */
  elSelections?: ElementSelection[];
}

export interface ChatInputHandle {
  /**
   * 清空输入框。
   *
   * `expectedDraftKey` 是提交时那个槽位：调用方通常先 await 发送、成功后再清，
   * 这段时间里用户可能已经切到别的会话。传进来的槽位与当前槽位不一致时，
   * 只清掉递交那个槽位的草稿，**不碰**编辑器——它现在属于另一个会话。
   */
  clear: (expectedDraftKey?: string) => void;
  focus: () => void;
  setPrompt: (text: string) => void;
  submit: () => void;
  isEmpty: () => boolean;
  selectFiles: () => void;
  addFiles: (files: ChatInputAttachedFile[]) => void;
  /**
   * 行首插入命令 chip，原草稿整体保留在其后（当作参数），光标落文末。
   * 供「+」菜单的命令入口使用 —— 那条路径没有斜杠菜单的光标位置可依赖。
   */
  insertCommandChip: (name: string) => void;
  /** 行首插入技能 chip；语义与 insertCommandChip 一致，前缀是 /skill:。 */
  insertSkillChip: (name: string) => void;
  /**
   * 把一段示例正文放进编辑器。草稿为空（或仅空白）时填入，否则追加到末尾 ——
   * 绝不覆盖已有文字；仅空白草稿被替换，是与 hasInputContent 同一套「空白不算内容」的定义。
   */
  appendPromptExample: (text: string) => void;
}

interface ChatInputProps {
  onSubmit: (data: ChatInputSubmitData) => void;
  onCompact?: (instructions?: string) => void;
  onCommand?: (action: string) => void;
  /** 草稿内容变化时上报（文本 / 贴图 / 附件任一存在即为 true）。 */
  onContentChange?: (hasInputContent: boolean) => void;
  disabled?: boolean;
  submitDisabled?: boolean;
  placeholder: string;
  cardClassName: string;
  textareaClassName: string;
  bottomSlot: React.ReactNode;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  slashMenuDirection?: "up" | "down";
  /** 附件列表变化时上报，供选择器标记「已添加」 */
  onAttachmentsChange?: (files: ChatInputAttachedFile[]) => void;
  /**
   * 每会话草稿槽位：通常是 sessionId；欢迎页用 NEW_SESSION_DRAFT_KEY。
   * 必填而非可选 —— 目前只有 ChatView / WelcomeView 两个调用点，
   * 「不传就不落盘」是一条没被要求的分支。
   */
  draftKey: string;
}

/** Base Tailwind classes for slash command menu items. */
/**
 * 编辑器自有样式：这些必须贴在编辑器元素上，不能依赖调用方传的 class。
 * `whitespace-pre-wrap` 让 insertLineBreak 插入的 <br> 与文本换行都生效。
 */
const EDITOR_BASE_CLASS =
  "whitespace-pre-wrap break-words outline-none focus:ring-0";

/** 草稿落盘的静默延迟：避开按键路径，也不至于丢太多输入。 */
const DRAFT_SAVE_DEBOUNCE_MS = 500;

export const SLASH_MENU_ITEM_BASE_CLASS =
  "w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2";

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      onSubmit,
      onCompact,
      onCommand,
      onContentChange,
      disabled = false,
      submitDisabled = false,
      placeholder,
      cardClassName,
      textareaClassName,
      bottomSlot,
      isExpanded = false,
      onToggleExpand,
      slashMenuDirection,
      onAttachmentsChange,
      draftKey,
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
    const [elementSelections, setElementSelections] = useState<
      ElementSelection[]
    >([]);

    // 拾取器推送选中元素。仅挂载期间生效，unmount 必须退订。
    useEffect(() => {
      const unsub = window.electronAPI?.browser?.picker?.onSelected(
        (selection) => {
          // 同一元素重复 pick 不产生第二张磁贴（element-selections 有单测）
          setElementSelections((prev) => addElementSelection(prev, selection));
        },
      );
      return unsub;
    }, []);
    const [isDragging, setIsDragging] = useState(false);
    const openLightbox = useAppStore((s) => s.openLightbox);
    /** 扩展命令名集合：判断行首的 /word 要不要渲染成命令 token（内置命令由解析器自带）。 */
    const commandLabels = useAppStore((s) => s.commandLabels);
    const closeLightbox = useAppStore((s) => s.closeLightbox);
    const lightboxSource = useAppStore((s) => s.lightboxSource);

    const SLASH_TABS: readonly SlashTab[] = ["all", "commands", "skills"];

    // --- Slash command menu ---
    const [slashSkills, setSlashSkills] = useState<Skill[]>([]);
    // 星标是本机 localStorage 数据，斜杠菜单与「+」菜单各读各的；这里持有状态
    // 只是为了点星后本行立刻重渲染。
    const [pinnedSkills, setPinnedSkills] = useState<string[]>(() =>
      loadPinnedSkills(),
    );

    const toggleSkillPin = useCallback((name: string) => {
      setPinnedSkills(togglePinnedSkill(name));
    }, []);
    const [extensionCommands, setExtensionCommands] = useState<SlashCommand[]>(
      [],
    );
    const [showSlashMenu, setShowSlashMenu] = useState(false);
    const [slashFilter, setSlashFilter] = useState("");
    const [slashStartIndex, setSlashStartIndex] = useState(-1);
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const [slashActiveTab, setSlashActiveTab] = useState<SlashTab>(() => {
      try {
        const stored = localStorage.getItem("slashActiveTab");
        if (stored === "all" || stored === "commands" || stored === "skills")
          return stored;
      } catch {
        /* noop */
      }
      return "all";
    });
    const [recencyVersion, setRecencyVersion] = useState(0);
    const slashMenuRef = useRef<HTMLDivElement>(null);

    /**
     * 输入框编辑器。非受控：React 只在挂载与显式写入路径上碰它的 DOM，
     * 编辑期间一个字节都不碰 —— 这是输入法、原生撤销、原生选区活着的前提。
     */
    const editorRef = useRef<HTMLDivElement>(null);
    const slashTriggerRef = useRef(false);
    const selectFilesRef = useRef<() => void>(() => {});
    /** Tracks whether an IME (e.g. Chinese Pinyin) composition is in progress. */
    const isComposingRef = useRef(false);
    /** Token to cancel stale async attaches when user clicks another image. */
    const attachLoadTokenRef = useRef(0);

    // --- Auto-resize editor ---
    const adjustEditorHeight = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;
      el.style.height = "auto";
      const computedStyle = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
      const maxHeight = lineHeight * (isExpanded ? 15 : 6);
      const minHeight = isExpanded ? lineHeight * 5 : 0;
      const rawHeight = Math.min(el.scrollHeight, maxHeight);
      const nextHeight = Math.max(rawHeight, minHeight);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [isExpanded]);

    const getPlainText = useCallback(
      () => serializeEditor(editorRef.current),
      [],
    );

    /**
     * 编辑器内容的统一写入口：清空、斜杠插入、外部 setPrompt、扩展 setEditorText 全走它。
     *
     * 这样"行首的 /命令 要不要渲染成 token"只有一处判断 —— 否则会出现输入框里是
     * 纯文本、气泡里却是 chip 的分裂（扩展命令尤其容易踩）。
     */
    const writeEditorText = useCallback(
      (text: string) => {
        setEditorFromText(editorRef.current, text, commandLabels);
        setPrompt(text);
      },
      [commandLabels],
    );

    useEffect(() => {
      adjustEditorHeight();
    }, [prompt, adjustEditorHeight]);

    // --- 向父组件上报草稿内容（底栏据此决定展开按钮是否可见）---
    useEffect(() => {
      onContentChange?.(
        hasInputContent(
          getPlainText(),
          pastedImages.length,
          attachedFiles.length,
          elementSelections.length,
        ),
      );
    }, [
      getPlainText,
      prompt,
      pastedImages,
      attachedFiles,
      elementSelections,
      onContentChange,
    ]);

    // --- 每会话草稿：挂载恢复 / 切槽位时先 flush 旧再 load 新 / 变更后 debounce 落盘 ---
    const latestDraftRef = useRef<ChatDraft>(EMPTY_DRAFT);
    const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const draftKeyRef = useRef(draftKey);
    const draftRestoredRef = useRef(false);

    /**
     * 把编辑器与附件状态拍成一份草稿快照。
     * 文本必须以 DOM 为权威来源（serializeEditor），不能读 `prompt` state ——
     * 编辑器是非受控的，state 可能比 DOM 旧一帧。
     *
     * 依赖里的 `prompt` 不参与计算，只用来让 identity 变化：它是编辑器每次 input
     * 都会 setPrompt 的镜像，而 debounce effect 唯一的依赖就是这个函数。不把
     * `prompt` 放进来的后果是「纯文字输入永远不重排定时器」—— 敲完字直接退出
     * 应用就丢草稿，正好弄掉本功能最核心的那个承诺。
     */
    const captureDraft = useCallback(
      (): ChatDraft => ({
        v: DRAFT_SCHEMA_VERSION,
        text: serializeEditor(editorRef.current),
        // 只存 base64：`url` 是 object URL，per-document，落盘再恢复就是死链。
        images: pastedImages.map(({ base64, mediaType }) => ({
          base64,
          mediaType,
        })),
        files: [...attachedFiles],
        elSelections: [...elementSelections],
      }),
      // prompt 必须留着，不是给函数体用的 —— 见上面的注释。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [prompt, pastedImages, attachedFiles, elementSelections],
    );

    /**
     * 把一份草稿整块写回输入框。
     *
     * 图片用 `data:` URL 而不是重建 object URL：`atob` + `Uint8Array` + `createObjectURL`
     * 虽然也是同步 API，但实测 540K 字符要 15.9 ms、5M 字符要 143.3 ms，
     * 切一次会话带几张图就会卡住主线程。data URL 只是字符串拼接，零 CPU。
     * 代价是被恢复的图片会同时持有 base64 与 data URL 两份等长字符串（清空即释放）。
     *
     * data URL 上调用 `revokeObjectURL` 是 no-op，所以既有的 removeImage / clear()
     * 对恢复出来的图片照样安全。
     */
    const applyDraft = useCallback(
      (draft: ChatDraft) => {
        writeEditorText(draft.text);
        setPastedImages((prev) => {
          prev.forEach((image) => URL.revokeObjectURL(image.url));
          return draft.images.map((image) => ({
            ...image,
            url: `data:${image.mediaType};base64,${image.base64}`,
          }));
        });
        setAttachedFiles([...draft.files]);
        setElementSelections([...draft.elSelections]);
        adjustEditorHeight();
      },
      [writeEditorText, adjustEditorHeight],
    );

    /**
     * 每次 commit 刷新快照引用。
     *
     * **声明顺序是承重的**：必须排在下面两个 effect 之前。切会话那一帧先跑它，
     * 此时组件 state 仍属于旧会话，`writeDraft(previousKey, ...)` 才会写对槽位。
     *
     * 刻意**不给依赖数组**：它要做的是「把此刻编辑器与 state 的现状抓下来」，
     * 而 `captureDraft` 的 identity 只跟四个 state 走；一旦用 `[captureDraft]`，
     * 正确性就挂在一条隐式不变量上（“DOM 变更必定伴随 setPrompt”）。
     * 今天是成立的（onInput 末尾无条件 setPrompt），但将来任何一次"只改 DOM 不改 state"
     * 的写入（新增的命令式 handle、就地改写令牌的格式化）都会静默让快照发霉，
     * 代价是卸载时丢掉草稿尾部。这个 serializeEditor 只走编辑器顶层子节点，
     * 相对于 React 自己每次 commit 的工作量可以忽略。
     */
    useEffect(() => {
      latestDraftRef.current = captureDraft();
    });

    // 挂载：恢复本槽位的草稿。App 带着 lastSessionId 启动时，这里是唯一的首次恢复点。
    // 用 ref 保证「只跑一次」—— 若依赖 applyDraft，commandLabels 从 IPC 回来时会
    // 再跑一次，把用户这期间敲的字覆盖掉。
    useEffect(() => {
      if (draftRestoredRef.current) return;
      draftRestoredRef.current = true;
      const draft = readDraft(draftKeyRef.current);
      if (draft) applyDraft(draft);
    }, [applyDraft]);

    // 切槽位：**先 flush 旧槽位，再 load 新槽位**。顺序颠倒就是把新内容写进旧槽位。
    useEffect(() => {
      const previousKey = draftKeyRef.current;
      if (previousKey === draftKey) return;

      if (draftSaveTimerRef.current !== null) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      writeDraft(previousKey, latestDraftRef.current);
      applyDraft(readDraft(draftKey) ?? EMPTY_DRAFT);
      draftKeyRef.current = draftKey;
    }, [draftKey, applyDraft]);

    // 内容变化 → debounce 落盘。
    // 这里读 `draftKeyRef`（发火时刻的真实槽位）而不是把 `draftKey` 放进依赖：
    // 槽位切换由上面的 effect 负责 flush + 取消待写，两处各管一段，才不会串槽位。
    useEffect(() => {
      if (draftSaveTimerRef.current !== null) {
        clearTimeout(draftSaveTimerRef.current);
      }
      draftSaveTimerRef.current = setTimeout(() => {
        draftSaveTimerRef.current = null;
        writeDraft(draftKeyRef.current, latestDraftRef.current);
      }, DRAFT_SAVE_DEBOUNCE_MS);
      return () => {
        if (draftSaveTimerRef.current !== null) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
      };
    }, [captureDraft]);

    // 卸载：把最后一次快照落盘。
    // main.tsx 已移除 StrictMode（注释写明是为了避免 IPC 双调用），所以不存在
    // 开发期「模拟卸载」把草稿写空的风险。这里必须是值快照：serializeEditor(null)
    // 返回空串，重新调 captureDraft() 会把草稿当成「空草稿」删掉。
    useEffect(
      () => () => {
        if (draftSaveTimerRef.current !== null) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        writeDraft(draftKeyRef.current, latestDraftRef.current);
      },
      [],
    );

    // --- Load skills for slash menu ---
    useEffect(() => {
      if (!isElectron || !window.electronAPI?.skills || !showSlashMenu) return;
      window.electronAPI.skills
        .getAll()
        .then((skills: Skill[]) => {
          setSlashSkills(skills.filter((s) => s.enabled));
        })
        .catch(() => {});
    }, [isElectron, showSlashMenu]);

    // 斜杠菜单每次打开都重读星标：星标可能在「+」菜单里被改过，而两个菜单不共享
    // state（各自只在打开时读存储）。少了这一段，用户在「+」菜单里取消掉的星标
    // 在斜杠菜单里仍是实心星，点一下反而把它重新固定。
    useEffect(() => {
      if (showSlashMenu) setPinnedSkills(loadPinnedSkills());
    }, [showSlashMenu]);

    // --- Load extension commands for slash menu (per active session cwd) ---
    const activeSessionCwd = useCurrentSession()?.cwd;
    useEffect(() => {
      if (!isElectron || !window.electronAPI?.piCommands) return;
      let disposed = false;
      const refresh = () => {
        window.electronAPI.piCommands
          .list(activeSessionCwd)
          .then((dto) => {
            if (!disposed) {
              setExtensionCommands(toSlashCommands(dto.commands));
              useAppStore
                .getState()
                .setCommandLabels(
                  new Map(
                    dto.commands.map((c) => [
                      c.name,
                      c.displayName || `/${c.name}`,
                    ]),
                  ),
                );
            }
          })
          .catch(() => {});
      };
      refresh();
      // Refresh when a plugin is installed/uninstalled. The registry is
      // per-cwd; when the session has no cwd we fall back to the default
      // host, so refresh unconditionally in that case.
      const unsubscribe = window.electronAPI.on((event) => {
        if (
          event.type === "commands.changed" &&
          (!activeSessionCwd || event.payload.cwd === activeSessionCwd)
        ) {
          refresh();
        }
      });
      return () => {
        disposed = true;
        unsubscribe();
      };
    }, [isElectron, activeSessionCwd]);

    // --- Click outside to close slash menu ---
    // Pi 扩展 setEditorText：写入输入框并清空待处理状态
    const pendingEditorText = useAppStore((s) => s.pendingEditorText);
    useEffect(() => {
      if (pendingEditorText === null) return;
      writeEditorText(pendingEditorText);
      adjustEditorHeight();
      useAppStore.getState().setPendingEditorText(null);
    }, [pendingEditorText, writeEditorText, adjustEditorHeight]);

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
      clear(expectedDraftKey?: string) {
        const submittedKey = expectedDraftKey ?? draftKeyRef.current;
        if (submittedKey !== draftKeyRef.current) {
          // 提交之后用户已经切走：编辑器现在属于另一个会话，一个字都不能碰，
          // 只把"刚发出去"的那份草稿清掉。
          removeDraft(submittedKey);
          return;
        }
        // DOM 是权威来源，所以清空要同时落两处：编辑器内容与 state。
        writeEditorText("");
        pastedImages.forEach((img) => URL.revokeObjectURL(img.url));
        setPastedImages([]);
        setAttachedFiles([]);
        setElementSelections([]);
        adjustEditorHeight();
        // 槽位草稿立即删除，不等 debounce：「发送成功 → 父组件 clear() → 立刻卸载」
        // 全在同一个 React 批次里，卸载 flush 若读到 clear 之前的快照，
        // 已发出的文本会在下次打开时"复活"（WelcomeView 的 __new__ 槽位最明显）。
        if (draftSaveTimerRef.current !== null) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        latestDraftRef.current = EMPTY_DRAFT;
        removeDraft(draftKeyRef.current);
      },
      focus() {
        editorRef.current?.focus();
      },
      setPrompt(text: string) {
        // 外部写入也要 parse：不 parse 的话，写进来的 /skill:x 不会渲染成 token，
        // 与手动选择技能的表现不一致（设计文档 §5.2）。
        writeEditorText(text);
        requestAnimationFrame(() => {
          editorRef.current?.focus();
          placeCaretAtEnd(editorRef.current);
        });
      },
      insertCommandChip(name: string) {
        const raw = `/${name} `; // 尾部空格把 chip 与后面的文本分开
        const draft = getPlainText();
        // 行首已经是同一条命令（后面是空白或结尾）就不再叠加：再叠一层会得到
        // `/goal /goal x`，会被 goal-extension 当成目标描述启动循环。
        // 命中时也必须走下面的聚焦 + 光标归位 —— 第二次点击同样要把焦点交回输入框，
        // 否则焦点会留在刚卸载的菜单按钮上。
        if (!new RegExp(`^/${name}(\\s|$)`).test(draft)) {
          writeEditorText(`${raw}${draft}`);
        }
        requestAnimationFrame(() => {
          editorRef.current?.focus();
          placeCaretAtEnd(editorRef.current);
        });
      },
      insertSkillChip(name: string) {
        const raw = `/skill:${name} `;
        const draft = getPlainText();
        // 斜杠菜单之外的插入路径（欢迎页 chip、+ 菜单技能行）也要记一次"用过"：
        // 不记的话「+」菜单的"最近调用"补齐永远是空的。
        saveSlashRecency(`skill:${name}`);
        // 判重必须针对 /skill:<name> 而不是 /<name>：insertCommandChip 的正则
        // `^/${name}(\s|$)` 匹配不到这种形式，照搬会让重复点击叠成
        // `/skill:pdf /skill:pdf`，渲染出两个令牌。
        //
        // 技能名要转义再拼进正则：当前数据表里全是 [a-z-]，但这是 public handle
        // 接口，带 `.` 的名字会误匹配、带 `[` 的名字会直接抛 SyntaxError。
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`^/skill:${escaped}(\\s|$)`).test(draft)) {
          writeEditorText(`${raw}${draft}`);
        }
        requestAnimationFrame(() => {
          editorRef.current?.focus();
          placeCaretAtEnd(editorRef.current);
        });
      },
      appendPromptExample(text: string) {
        const draft = getPlainText();
        writeEditorText(draft.trim() === "" ? text : `${draft} ${text}`);
        requestAnimationFrame(() => {
          editorRef.current?.focus();
          placeCaretAtEnd(editorRef.current);
        });
      },
      submit() {
        // Trigger form submit programmatically
        handleSubmitInternal();
      },
      isEmpty() {
        return !hasInputContent(
          getPlainText(),
          pastedImages.length,
          attachedFiles.length,
          elementSelections.length,
        );
      },
      selectFiles() {
        selectFilesRef.current();
      },
      addFiles(files: ChatInputAttachedFile[]) {
        setAttachedFiles((prev) => mergeAttachedFiles(prev, files));
      },
    }));

    // 上报附件列表：选择器用它把已附加的文件标成「已添加」。
    // setAttachedFiles 全部走 mergeAttachedFiles，所以重复注入不会触发这里。
    useEffect(() => {
      onAttachmentsChange?.(attachedFiles);
    }, [attachedFiles, onAttachmentsChange]);

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

    // --- Paste handler ---
    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/"),
      );
      if (imageItems.length === 0) {
        // 纯文本粘贴：只取 text/plain。不拦的话 contenteditable 会把对方的字体、
        // 颜色、嵌套标签一起粘进来。execCommand 虽已 deprecated，但在 Chromium 下
        // 是唯一保留原生撤销栈的插入方式；insertText 会触发 input 事件走到同步逻辑。
        const text = e.clipboardData?.getData("text/plain");
        if (text) {
          e.preventDefault();
          document.execCommand("insertText", false, text);
        }
        return;
      }
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
          const resizedBlob = await compressImageForLLM(blob);
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
      // Close lightbox only if currently showing pasted images
      if (lightboxSource === "pasted") closeLightbox();
    };

    const removeFile = (index: number) => {
      const removed = attachedFiles[index];
      const isImage =
        removed?.type?.startsWith("image/") ||
        /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(removed?.name || "");
      setAttachedFiles((prev) => {
        const updated = [...prev];
        updated.splice(index, 1);
        return updated;
      });
      // Close lightbox only if removing an image file while showing attached images
      if (lightboxSource === "attached" && isImage) closeLightbox();
    };

    /**
     * 点开图片型附件的大图。从附件列表的 map 回调里提出来：磁贴组件需要一个
     * 稳定的处理函数，而它原本靠闭包拿 index。
     */
    const handleAttachImageClick = async (index: number) => {
      const clicked = attachedFiles[index];
      // 原来靠 map 回调闭包拿到的 isImage —— 现在按 index 现算，语义不变：只有图片型附件才开大图。
      const isImage =
        !!clicked &&
        (clicked.type.startsWith("image/") ||
          /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(clicked.name || ""));
      if (!isImage) return;
      const token = ++attachLoadTokenRef.current;
      const imageFiles = attachedFiles
        .map<{ file: ChatInputAttachedFile; idx: number } | null>((f, i) => {
          const img =
            f.type.startsWith("image/") ||
            /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(f.name || "");
          return img ? { file: f, idx: i } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (imageFiles.length === 0) return;

      const startIdx = imageFiles.findIndex((x) => x.idx === index);

      const initialImages: ImageSource[] = imageFiles.map((f) => ({
        src: "",
        name: f.file.name,
        filePath: f.file.path || undefined,
      }));
      openLightbox(
        initialImages,
        startIdx >= 0 ? startIdx : 0,
        true,
        "attached",
      );

      const loadedImages = await Promise.all(
        imageFiles.map(async (f) => {
          try {
            if (f.file.inlineDataBase64) {
              return {
                src: `data:${f.file.type};base64,${f.file.inlineDataBase64}`,
                name: f.file.name,
                filePath: f.file.path || undefined,
              };
            }
            if (f.file.path && window.electronAPI?.readFile) {
              const result = await window.electronAPI.readFile(f.file.path);
              if (result) {
                const ext = f.file.name.split(".").pop()?.toLowerCase();
                const mime =
                  f.file.type ||
                  (ext && `image/${ext === "jpg" ? "jpeg" : ext}`) ||
                  "image/png";
                return {
                  src: `data:${mime};base64,${result}`,
                  name: f.file.name,
                  filePath: f.file.path || undefined,
                };
              }
            }
            return {
              src: "",
              name: f.file.name,
              filePath: f.file.path || undefined,
              error: true,
            };
          } catch {
            return {
              src: "",
              name: f.file.name,
              filePath: f.file.path || undefined,
              error: true,
            };
          }
        }),
      );

      // Discard results if a newer click started loading
      if (token !== attachLoadTokenRef.current) return;
      openLightbox(
        loadedImages,
        startIdx >= 0 ? startIdx : 0,
        false,
        "attached",
      );
    };

    /**
     * 把粘贴的图片与已附加的文件归一成同一种磁贴列表（设计文档 §4.3）。
     * 不用 useMemo：它引用的 removeImage / removeFile 每次渲染都是新函数，
     * 缓存不会命中，反而多一层需要维护的依赖数组。
     */
    const attachmentTiles: AttachmentTile[] = [
      ...pastedImages.map<AttachmentTile>((image, index) => ({
        kind: "image",
        key: image.url || `pasted-image-${index}`,
        url: image.url,
        alt: t("common.pastedImageAlt", { index: index + 1 }),
        onOpen: () =>
          openLightbox(
            pastedImages.map((item) => ({ src: item.url })),
            index,
            false,
            "pasted",
          ),
        onRemove: () => removeImage(index),
      })),
      ...attachedFiles.map<AttachmentTile>((file, index) => {
        const isImage =
          file.type.startsWith("image/") ||
          /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(file.name || "");
        return {
          kind: "file",
          key: attachmentKey(file),
          name: file.name,
          hint:
            file.source === "vault"
              ? t("attachChip.vaultSource", { name: file.name })
              : file.path || file.name,
          onOpen: isImage
            ? () => {
                void handleAttachImageClick(index);
              }
            : undefined,
          onRemove: () => removeFile(index),
        };
      }),
      ...elementSelections.map<AttachmentTile>((selection) => ({
        kind: "element",
        key: selectionKey(selection),
        title: `${selection.tag}${selection.classes.length ? `.${selection.classes[0]}` : ""}`,
        summary: `"${selection.text}" ${selection.rect.width}×${selection.rect.height}`,
        hint: `${selection.tag}${selection.classes.length ? `.${selection.classes[0]}` : ""} "${selection.text}" ${selection.rect.width}×${selection.rect.height} · ${selection.selector}`,
        badge: selection.selectorUnique ? undefined : "attachTile.notUnique",
        onOpen: () => {
          // 磁贴的用处是「回到真实页面里定位它」。面板没开的话高亮看不见，
          // 用户会以为点了没反应，所以先把它显示出来再高亮。
          const store = useAppStore.getState();
          if (store.rightPanelMode !== "browser") store.toggleBrowserPanel();
          void window.electronAPI?.browser?.picker?.highlight(
            selection.selector,
          );
        },
        onRemove: () => {
          setElementSelections((prev) =>
            removeElementSelection(prev, selectionKey(selection)),
          );
        },
      })),
    ];

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
        setAttachedFiles((prev) => mergeAttachedFiles(prev, newFiles));
      } catch (error) {
        console.error("[ChatInput] Error selecting files:", error);
      }
    };

    selectFilesRef.current = handleFileSelect;

    // --- Slash menu helpers ---
    const builtinCommands = useMemo(() => getBuiltinCommands(t), [t]);
    const allCommands = useMemo(
      () => mergeSlashCommands(builtinCommands, extensionCommands),
      [builtinCommands, extensionCommands],
    );
    const filteredCommands = useMemo(() => {
      const recency = loadSlashRecency();
      // Commands use exact-prefix matching (exact-prefix priority over skills)
      const cmds = slashFilter
        ? filterCommands(allCommands, slashFilter)
        : allCommands;
      return sortByRecency(cmds, (c) => `cmd:${c.name}`, recency);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCommands, slashFilter, recencyVersion]);

    // Skills filtered by current text (preserving Skill type for SlashMenu badges)
    const filteredSlashSkills = useMemo(() => {
      const recency = loadSlashRecency();
      const skills = !slashFilter
        ? slashSkills
        : slashSkills.filter((s) => {
            const ft = slashFilter.toLowerCase();
            return (
              s.name.toLowerCase().includes(ft) ||
              (s.description || "").toLowerCase().includes(ft)
            );
          });
      return sortByRecency(skills, (s) => `skill:${s.name}`, recency);
    }, [slashSkills, slashFilter, recencyVersion]);

    // Merged "all" tab list: commands then skills, ordered by overall recency.
    // Input order [commands..., skills...] keeps the never-used default order
    // identical to the previous grouped view: builtin → plugin → skills.
    const filteredAllItems = useMemo(() => {
      const recency = loadSlashRecency();
      const cmds: SlashItem[] = filteredCommands.map((c) => ({
        category: "command",
        command: c,
      }));
      const skills: SlashItem[] = filteredSlashSkills.map((s) => ({
        category: "skill",
        skill: { name: s.name, description: s.description },
      }));
      return sortByRecency(
        [...cmds, ...skills],
        (item) =>
          item.category === "command"
            ? `cmd:${item.command.name}`
            : `skill:${item.skill.name}`,
        recency,
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredCommands, filteredSlashSkills, recencyVersion]);

    // Compute count of items in current tab for keyboard nav clamping
    const visibleItemCount = useMemo(() => {
      if (slashActiveTab === "all") return filteredAllItems.length;
      if (slashActiveTab === "commands") return filteredCommands.length;
      return filteredSlashSkills.length;
    }, [
      slashActiveTab,
      filteredAllItems.length,
      filteredCommands.length,
      filteredSlashSkills.length,
    ]);

    const handleTabChange = useCallback((tab: SlashTab) => {
      setSlashActiveTab(tab);
      setSlashSelectedIndex(0);
      try {
        localStorage.setItem("slashActiveTab", tab);
      } catch {
        /* noop */
      }
    }, []);

    // Resolve SlashItem by tab + index for keyboard Enter selection
    const getSlashItemByIndex = (
      tab: SlashTab,
      idx: number,
    ): SlashItem | null => {
      if (tab === "all") return filteredAllItems[idx] ?? null;
      if (tab === "commands") {
        const cmd = filteredCommands[idx];
        return cmd ? { category: "command", command: cmd } : null;
      }
      const skill = filteredSlashSkills[idx];
      return skill
        ? {
            category: "skill",
            skill: { name: skill.name, description: skill.description },
          }
        : null;
    };

    const closeSlashMenu = useCallback(() => {
      setShowSlashMenu(false);
      setSlashFilter("");
      setSlashStartIndex(-1);
      setSlashSelectedIndex(0);
    }, []);

    const clearSlashText = useCallback(() => {
      const el = editorRef.current;
      if (!el || slashStartIndex < 0) return;
      // 同上：拿不到光标就整段丢弃斜杠过滤串。
      const cursorPos = getCaretOffset(el);
      const after = cursorPos > 0 ? serializeEditor(el).slice(cursorPos) : "";
      writeEditorText(after);
      requestAnimationFrame(() => {
        el.focus();
        placeCaretAtEnd(el);
      });
    }, [slashStartIndex, writeEditorText]);

    /**
     * 把引用原文插到编辑器开头。
     *
     * 斜杠菜单只在文本开头触发，所以不需要任何光标偏移计算：用「原文 + 光标之后的
     * 剩余文本」重建内容即可。setEditorFromText 会把行首的引用渲染成原子 token。
     */
    const insertReferenceText = useCallback(
      (replacement: string) => {
        const el = editorRef.current;
        // 菜单只在文本开头打开，所以光标位置至少是 1（斜杠本身）。
        // getCaretOffset 返回 0 表示拿不到编辑器内的光标（例如焦点已经移走），
        // 此时斜杠过滤串整段丢弃 —— 留在正文里就是垃圾。
        const cursorPos = getCaretOffset(el);
        const after = cursorPos > 0 ? getPlainText().slice(cursorPos) : "";
        writeEditorText(`${replacement}${after}`);
        closeSlashMenu();
        adjustEditorHeight();
        requestAnimationFrame(() => {
          el?.focus();
          placeCaretAtEnd(el);
        });
      },
      [adjustEditorHeight, closeSlashMenu, getPlainText, writeEditorText],
    );

    const selectSlashItem = useCallback(
      (item: SlashItem) => {
        // Record recency before any early-return path
        saveSlashRecency(
          item.category === "command"
            ? `cmd:${item.command.name}`
            : `skill:${item.skill.name}`,
        );
        setRecencyVersion((v) => v + 1);

        if (item.category === "command") {
          if (item.command.action === "compact") {
            onCommand?.(item.command.action);
            clearSlashText();
            closeSlashMenu();
            return;
          }
          // For other commands (goal, extension commands), insert text
          insertReferenceText(`/${item.command.name} `);
          return;
        }
        // skill: insert text — all skills use /skill:name syntax
        insertReferenceText(`/skill:${item.skill.name} `);
      },
      [closeSlashMenu, clearSlashText, insertReferenceText, onCommand],
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
            const resizedBlob = await compressImageForLLM(file);
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
        setAttachedFiles((prev) => mergeAttachedFiles(prev, newFiles));
      }
    };

    // --- Submit ---
    const handleSubmitInternal = useCallback(() => {
      // DOM 是权威来源；state 只是镜像（可能比 DOM 旧一帧）。
      const currentPrompt = getPlainText() || prompt;
      if (
        !hasInputContent(
          currentPrompt,
          pastedImages.length,
          attachedFiles.length,
          elementSelections.length,
        )
      )
        return;
      if (disabled || submitDisabled) return;

      // --- /compact command interception ---
      if (currentPrompt.startsWith("/compact")) {
        const instructions =
          currentPrompt.slice("/compact".length).trim() || undefined;
        onCompact?.(instructions);
        writeEditorText("");
        adjustEditorHeight();
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
        // 不在 onSubmit 后立即清空：由父组件既有的成功/入队路径调 clear()
        ...(elementSelections.length
          ? { elSelections: elementSelections }
          : {}),
      });
    }, [
      getPlainText,
      writeEditorText,
      adjustEditorHeight,
      prompt,
      pastedImages,
      attachedFiles,
      elementSelections,
      disabled,
      submitDisabled,
      onSubmit,
      onCompact,
      isExpanded,
      onToggleExpand,
    ]);

    const handleFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      handleSubmitInternal();
    };

    return (
      <>
        <form
          onSubmit={handleFormSubmit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="relative w-full"
        >
          {/* Input card wrapper — keeps slash menu outside card div so space-y-* doesn't add margin to textarea */}
          <div className="relative">
            {/* Slash command menu */}
            {showSlashMenu && (
              <div ref={slashMenuRef}>
                <SlashMenu
                  commands={filteredCommands}
                  skills={filteredSlashSkills}
                  allItems={filteredAllItems}
                  activeTab={slashActiveTab}
                  selectedIndex={slashSelectedIndex}
                  onSelect={selectSlashItem}
                  onTabChange={handleTabChange}
                  pinnedSkills={pinnedSkills}
                  onToggleSkillPin={toggleSkillPin}
                  direction={slashMenuDirection}
                />
              </div>
            )}
            {/* Input card */}
            <div
              className={`transition-colors ${isDragging ? "ring-2 ring-accent bg-accent/5" : ""} ${cardClassName}`}
            >
              <AttachmentTiles tiles={attachmentTiles} />
              <div
                ref={editorRef}
                contentEditable={!disabled}
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label={placeholder}
                data-placeholder={placeholder}
                spellCheck={false}
                className={`chat-editor ${EDITOR_BASE_CLASS} ${textareaClassName}`}
                onInput={() => {
                  const el = editorRef.current;
                  if (!el) return;
                  // 编辑期间 DOM 是权威来源，state 只是它的镜像。
                  // token 只存在于行首：一旦行首插入了别的字，它立即退回纯文本
                  // —— 与气泡渲染同一条规则。组合期间不碰 DOM（设计文档 §5.5）。
                  if (!isComposingRef.current) degradeNonLeadingTokens(el);
                  const newValue = serializeEditor(el);
                  const isComposing = isComposingRef.current;

                  // Slash menu trigger: onKeyDown sets slashTriggerRef when '/' is pressed
                  if (slashTriggerRef.current) {
                    slashTriggerRef.current = false;
                    if (el) {
                      const cursorPos = getCaretOffset(el);
                      // 只在文本开头触发：`/skill:x` 与 `/命令` 只在消息开头生效
                      // （pi 用 startsWith 判定），句中插入会静默失效。
                      // 不变量：菜单能打开的位置，必须正好是 token 能生效的位置。
                      // 用 <= 1 而不是 === 1：拿不到光标时 getCaretOffset 也返回 0，
                      // 那个情形与"斜杠在开头"一样应该开菜单，不该因为读不到选区就没反应。
                      if (cursorPos <= 1) {
                        setSlashStartIndex(cursorPos - 1);
                        setSlashFilter("");
                        setSlashSelectedIndex(0);
                        setShowSlashMenu(true);
                      }
                    }
                  }

                  // Filter while slash menu is open.
                  // 原文案：textarea 在组合期间会把 selectionStart 锁在组合起点，所以要取
                  // selectionEnd。contenteditable 下 DOM 里已包含正在组合的文本、光标就在它
                  // 之后，两者不再需要区分（依赖浏览器行为，由真机手验确认）。
                  if (showSlashMenu && el) {
                    const endPos = getCaretOffset(el);
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
                  // 组合期间跳过：选区在组合区间内移动，会误判成"斜杠被删"。
                  if (showSlashMenu && el && !isComposing) {
                    if (getCaretOffset(el) <= slashStartIndex) {
                      closeSlashMenu();
                    }
                  }

                  setPrompt(newValue);
                }}
                onPaste={handlePaste}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                  // input 事件在 compositionend 之后触发，会用正确的选区重新过滤，
                  // 所以这里不需要额外处理。
                }}
                onKeyDown={(e) => {
                  // Detect '/' key for slash menu trigger (before any state check)
                  if (
                    e.key === "/" &&
                    !disabled &&
                    !isComposingRef.current &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.altKey
                  ) {
                    slashTriggerRef.current = true;
                  }

                  // Slash menu keyboard nav
                  if (showSlashMenu) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashSelectedIndex((prev) =>
                        Math.min(prev + 1, Math.max(0, visibleItemCount - 1)),
                      );
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashSelectedIndex((prev) => Math.max(prev - 1, 0));
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      // During IME composition, let Enter finalize the IME
                      // instead of selecting a slash item. The
                      // compositionend → onChange chain will update the
                      // filter, so the user can press Enter again to select.
                      if (isComposingRef.current || e.keyCode === 229) return;
                      e.preventDefault();
                      const item = getSlashItemByIndex(
                        slashActiveTab,
                        slashSelectedIndex,
                      );
                      if (item) selectSlashItem(item);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeSlashMenu();
                      return;
                    }
                    // Tab key: cycle through tabs
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const currentIdx = SLASH_TABS.indexOf(slashActiveTab);
                      const nextIdx = (currentIdx + 1) % SLASH_TABS.length;
                      handleTabChange(SLASH_TABS[nextIdx]);
                      return;
                    }
                    // Cmd/Ctrl+1/2/3: switch to specific tab
                    if (
                      (e.metaKey || e.ctrlKey) &&
                      e.key >= "1" &&
                      e.key <= "3"
                    ) {
                      e.preventDefault();
                      const index = Number(e.key) - 1;
                      if (SLASH_TABS[index]) handleTabChange(SLASH_TABS[index]);
                      return;
                    }
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
                    if (isExpanded && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      document.execCommand("insertLineBreak");
                      return;
                    }
                    e.preventDefault();
                    handleSubmitInternal();
                    return;
                  }
                  // Shift+Enter 换行。div 上不拦会插入块级 <div>，破坏单行流，
                  // 所以显式插入 <br>（序列化时换算成 \n）。
                  if (e.key === "Enter" && e.shiftKey && !isExpanded) {
                    e.preventDefault();
                    document.execCommand("insertLineBreak");
                  }
                }}
              />
              {bottomSlot}
            </div>
          </div>
        </form>
      </>
    );
  },
);

/**
 * 草稿是否非空。文本（去空白）、贴图、附件任一存在即为非空。
 *
 * 行首技能令牌是修饰不是内容：只有 `/skill:x` 而没有正文时，这条消息没有需求，
 * 不该允许发送（否则白费一个回合，模型只会问「你想要什么」）。命令不受此限 ——
 * `/goal` 单独发是合法的。
 *
 * 单一来源：提交门禁、`isEmpty()` 与 `onContentChange` 上报共用它，三者必须永远一致
 * ——「展开按钮可见」与「能否提交」不能互相矛盾。改动此函数即同时改动三者，
 * 这是刻意的：三处对「有没有内容」必须是同一个答案。
 * 但取值来源不完全相同：提交门禁与 `isEmpty()` 读 `getPlainText()`（DOM 是权威来源，
 * state 可能比它旧一帧），`onContentChange` 走 effect 读同一份。判定函数相同，不是同一个值。
 */
export function hasInputContent(
  prompt: string,
  imageCount: number,
  fileCount: number,
  elementCount = 0,
): boolean {
  return (
    stripLeadingSkillToken(prompt).trim() !== "" ||
    imageCount > 0 ||
    fileCount > 0 ||
    elementCount > 0
  );
}
