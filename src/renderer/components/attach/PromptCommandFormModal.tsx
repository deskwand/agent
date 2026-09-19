/**
 * 新建 / 编辑自定义命令的表单弹窗。
 *
 * 命令名在编辑态只读：它是文件名，改名等于「写新文件 + 删旧文件」，
 * 会多出「目标名已存在」「删除失败」两类边界，本版不做（见设计文档 §9）。
 *
 * 没有「描述」字段：它只在斜杠菜单那行灰字里用，pi 会自动用正文首行兜底 ——
 * 这一格对用户是纯额外成本（见设计文档 §4.5）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Lock, Plus, Search, X } from "lucide-react";
import { useBrowserOcclusion } from "../../hooks/useBrowserOcclusion";
import type { PromptCommandSaveError } from "../../../shared/ipc-types";
import type { Skill } from "../../types";

export interface PromptCommandFormValue {
  name: string;
  displayName: string;
  content: string;
}

export interface PromptCommandFormModalProps {
  mode: "create" | "edit";
  initial: PromptCommandFormValue;
  /** 来自 main 的校验失败原因（保存后回填）；打开时一般是 null */
  nameError?: PromptCommandSaveError | null;
  saving: boolean;
  onSave: (value: PromptCommandFormValue) => void;
  onClose: () => void;
}

const NAME_ERROR_KEY: Record<string, string> = {
  empty: "chat.commandNameRequired",
  tooLong: "chat.commandNameInvalid",
  invalidChars: "chat.commandNameInvalid",
  leadingDot: "chat.commandNameInvalid",
  reserved: "chat.commandNameReserved",
  exists: "chat.commandNameExists",
  io: "chat.commandSaveFailed",
};

/**
 * 技能的 type → 徽章文案 key。与 SlashMenu 的技能徽章同一套口径，
 * 所以直接复用 skillMarket.source* 那组译法，不再起新词。
 */
const SKILL_TYPE_BADGE_KEY: Record<Skill["type"], string> = {
  builtin: "skillMarket.sourceBuiltin",
  mcp: "skillMarket.sourceMcp",
  custom: "skillMarket.sourceCustom",
  agent: "skillMarket.sourceAI",
};

export function PromptCommandFormModal({
  mode,
  initial,
  nameError = null,
  saving,
  onSave,
  onClose,
}: PromptCommandFormModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState<PromptCommandFormValue>(initial);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillListOpen, setSkillListOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillLoadFailed, setSkillLoadFailed] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const skillSearchRef = useRef<HTMLInputElement>(null);
  /** 光标位置。点「引用技能」按钮会让 textarea 失焦，那时读 selectionStart 可能已是末尾。 */
  const lastCaretRef = useRef<number | null>(null);

  useBrowserOcclusion(true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 两段：搜索框里有东西先清空，再按一次才关表单。
      // 不走「容器 onKeyDown + stopPropagation」那种靠事件顺序压制的写法 ——
      // 本组件的 Esc 本来就是 document 级的（弹窗体是 portal 到 body）。
      if (skillQuery) {
        setSkillQuery("");
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, skillQuery]);

  const canSave = !saving && value.name.trim() !== "" && value.content.trim() !== "";
  const nameErrorKey = nameError ? NAME_ERROR_KEY[nameError] : undefined;

  const update = (patch: Partial<PromptCommandFormValue>) =>
    setValue((prev) => ({ ...prev, ...patch }));

  const rememberCaret = useCallback(() => {
    const el = bodyRef.current;
    if (el) lastCaretRef.current = el.selectionStart;
  }, []);

  /** 技能清单与斜杠菜单同源，只列启用中的。点开时才拉（不打开就不花 IPC），失败可重点重试。 */
  const openSkillList = async () => {
    rememberCaret();
    setSkillQuery("");
    setSkillListOpen((open) => !open);
    if (skills.length > 0) return;
    try {
      const all = await window.electronAPI.skills.getAll();
      setSkills(all.filter((s) => s.enabled));
      setSkillLoadFailed(false);
    } catch {
      setSkillLoadFailed(true);
    }
  };

  /**
   * 技能名或描述的大小写不敏感子串匹配 —— 与斜杠菜单的技能过滤同口径
   *（那边也是 name/description 两处 includes）。
   */
  const visibleSkills = useMemo(() => {
    const needle = skillQuery.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        (s.description ?? "").toLowerCase().includes(needle),
    );
  }, [skills, skillQuery]);

  // 展开时聚焦搜索框（照 AttachPickerPanel 的做法）
  useEffect(() => {
    if (skillListOpen) skillSearchRef.current?.focus();
  }, [skillListOpen]);

  /**
   * 往正文的光标处插入一行技能引用 —— 插进去就是普通文本，用户能改能删。
   * 不做「已选技能」状态：.md 里就是这几行，重新打开表单天然可见。
   */
  const insertSkillReference = (name: string) => {
    const line = t("chat.commandSkillReference", { name });
    const caret = lastCaretRef.current ?? value.content.length;
    const before = value.content.slice(0, caret);
    const after = value.content.slice(caret);
    // 前面已有内容且不在行首时先补一个换行，保证这句自成一行
    const prefix = before === "" || before.endsWith("\n") ? "" : "\n";
    const suffix = after.startsWith("\n") || after === "" ? "" : "\n";
    const next = `${before}${prefix}${line}${suffix}${after}`;
    update({ content: next });
    setSkillQuery("");
    setSkillListOpen(false);
    // 焦点与光标还给正文，位置落在这句之后
    const caretAfter = before.length + prefix.length + line.length;
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretAfter, caretAfter);
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          mode === "create" ? t("chat.newCommandTitle") : t("chat.editCommandTitle")
        }
        className="mx-4 flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-6xl border border-border-subtle bg-background shadow-elevated animate-slide-up"
      >
        <div className="flex items-center gap-3 border-b border-border-muted px-5 py-[14px]">
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-text-primary">
            {mode === "create" ? t("chat.newCommandTitle") : t("chat.editCommandTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-xl p-2 text-text-secondary transition-colors hover:bg-surface-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* 1 · 命令名（必填） */}
          <div className="mb-4">
            <label
              data-field-label
              className="mb-1.5 block text-xs text-text-secondary"
              htmlFor="prompt-name"
            >
              {t("chat.commandName")}
            </label>
            <div
              className={`flex items-center gap-2 rounded-xl border bg-surface-muted px-3 py-2 ${
                nameErrorKey ? "border-error" : "border-border"
              }`}
            >
              <input
                id="prompt-name"
                data-field="name"
                aria-label={t("chat.commandName")}
                value={value.name}
                readOnly={mode === "edit"}
                onChange={(e) => update({ name: e.target.value })}
                placeholder={t("chat.commandNamePlaceholder")}
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text-primary outline-none"
              />
              {mode === "edit" && <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
            </div>
            {mode === "edit" && (
              <p className="mt-1.5 text-xs text-text-muted">{t("chat.commandNameHint")}</p>
            )}
            {nameErrorKey && (
              <p className="mt-1 text-xs text-error">
                {t(nameErrorKey, { name: value.name })}
              </p>
            )}
          </div>

          {/* 2 · 正文（必填）+ 引用技能（贴在同一行的右侧） */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label
                data-field-label
                className="text-xs text-text-secondary"
                htmlFor="prompt-content"
              >
                {t("chat.commandBody")}
              </label>
              <button
                type="button"
                data-skill-trigger
                aria-label={t("chat.commandInsertSkillHint")}
                onClick={() => void openSkillList()}
                className="inline-flex h-6 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-[11.5px] text-text-primary transition-colors hover:bg-surface-hover"
              >
                <Plus className="h-3 w-3" />
                {t("chat.commandInsertSkill")}
              </button>
            </div>

            {skillListOpen && (
              <div
                data-skill-list
                className="mb-1.5 rounded-xl border border-border bg-background shadow-elevated"
              >
                {/* 搜索行固定在滚动区之外 —— 否则列表一滚就把搜索框卷走了 */}
                <div className="relative border-b border-border-muted px-1.5 py-1.5">
                  <Search className="pointer-events-none absolute left-[17px] top-[17px] h-3.5 w-3.5 text-text-muted" />
                  <input
                    ref={skillSearchRef}
                    data-skill-search
                    value={skillQuery}
                    onChange={(e) => setSkillQuery(e.target.value)}
                    placeholder={t("chat.commandSkillSearchPlaceholder")}
                    aria-label={t("chat.commandSkillSearchPlaceholder")}
                    className="h-8 w-full rounded-lg bg-surface-muted pl-7 pr-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
                <div data-skill-scroll className="max-h-48 overflow-y-auto p-1">
                  {visibleSkills.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      data-skill-option={skill.name}
                      onClick={() => insertSkillReference(skill.name)}
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-text-primary">
                          {skill.name}
                        </span>
                        {skill.description && (
                          <span className="block truncate text-xs text-text-muted">
                            {skill.description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] text-text-secondary">
                        {t(SKILL_TYPE_BADGE_KEY[skill.type])}
                      </span>
                    </button>
                  ))}
                  {visibleSkills.length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-text-muted">
                      {skillLoadFailed
                        ? t("chat.commandSkillLoadFailed")
                        : skillQuery.trim()
                          ? t("chat.commandSkillNoMatch")
                          : t("chat.commandSkillEmpty")}
                    </p>
                  )}
                </div>
              </div>
            )}

            <textarea
              id="prompt-content"
              ref={bodyRef}
              data-field="body"
              aria-label={t("chat.commandBody")}
              value={value.content}
              onChange={(e) => {
                update({ content: e.target.value });
                lastCaretRef.current = e.target.selectionStart;
              }}
              onSelect={rememberCaret}
              onClick={rememberCaret}
              onKeyUp={rememberCaret}
              placeholder={t("chat.commandBodyPlaceholder")}
              className="min-h-[140px] w-full resize-none rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm leading-relaxed text-text-primary outline-none"
            />
          </div>

          {/* 3 · 显示名称（可选，放最后：填到这儿就知道已经能保存了） */}
          <div>
            <label
              data-field-label
              className="mb-1.5 block text-xs text-text-secondary"
              htmlFor="prompt-display-name"
            >
              {t("chat.commandDisplayName")}
            </label>
            <input
              id="prompt-display-name"
              data-field="displayName"
              aria-label={t("chat.commandDisplayName")}
              value={value.displayName}
              onChange={(e) => update({ displayName: e.target.value })}
              placeholder={t("chat.commandDisplayNameHint")}
              className="w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-text-primary outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-muted px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-border px-4 text-sm text-text-primary transition-colors hover:bg-surface-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-form-save
            disabled={!canSave}
            onClick={() => onSave(value)}
            className="h-9 rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:border disabled:border-border-muted disabled:bg-surface-muted disabled:text-text-muted"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
