// ask_user 内联卡片：pending 可交互 / answered、cancelled、interrupted 只读。
// 状态判定：findToolResult 找到 result → 解析 answers（answered）或
// askUserStatus（cancelled）；无 result 且 pendingAskUsers 有本块 → pending；
// 无 result 且非 pending → interrupted（会话重启/历史重放）。
// 视觉遵循已确认 mockup：左侧状态色竖条（pending 靛蓝语义 Token bg-accent、
// answered/cancelled 灰）、header 彩色胶囊、题间虚线分隔、底部按钮区。
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import { ASK_USER_SKIPPED } from "../../../shared/ask-user";
import type { AskUserAnswers, AskUserQuestion } from "../../../shared/ask-user";
import type { ContentBlock, ToolUseContent, Message } from "../../types";
import { findToolResult } from "../../utils/tool-result-summary";
import { useAppStore } from "../../store";
import { useIPC } from "../../hooks/useIPC";

interface AskUserCardProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  allMessages: Message[];
}

// "其他…" 与 text 题共用同一份上限，与工具侧校验保持一致。
const ASK_USER_INPUT_MAX_LENGTH = 2000;

const OPTION_BASE =
  "w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default";
const OPTION_IDLE =
  "border-border-subtle bg-surface-muted hover:bg-surface-hover";
const OPTION_SELECTED = "border-accent bg-accent/10";
const INPUT_BASE =
  "w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none";

export function AskUserCard({
  block,
  allBlocks,
  allMessages,
}: AskUserCardProps) {
  const { t } = useTranslation();
  const { submitAskUser } = useIPC();
  const pendingAskUsers = useAppStore((s) => s.pendingAskUsers);
  const pendingRequest = pendingAskUsers[block.id];

  const questions =
    ((block.input as Record<string, unknown>)?.questions as
      | AskUserQuestion[]
      | undefined) ??
    pendingRequest?.questions ??
    [];

  const resultBlock = useMemo(
    () => findToolResult(block.id, allBlocks, allMessages),
    [block.id, allBlocks, allMessages],
  );

  // 已提交答案（从 tool_result 文本 JSON 解析）
  const answers: AskUserAnswers | undefined = useMemo(() => {
    if (!resultBlock || resultBlock.askUserStatus === "cancelled")
      return undefined;
    const text =
      typeof resultBlock.content === "string" ? resultBlock.content : "";
    try {
      const parsed = JSON.parse(text) as { answers?: AskUserAnswers };
      return parsed.answers;
    } catch {
      return undefined;
    }
  }, [resultBlock]);

  // 草稿状态（仅 pending 态使用）
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [multi, setMulti] = useState<Record<number, string[]>>({});
  const [textInput, setTextInput] = useState<Record<number, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [locked, setLocked] = useState(false);
  // 提交瞬间的答案快照：主进程在 tool_result 返回前就发 dismiss 清除 pending，
  // 期间用快照渲染已答/已跳过态，避免闪现“会话已中断”
  const [submittedAnswers, setSubmittedAnswers] =
    useState<AskUserAnswers | null>(null);

  // 展示用答案：优先 tool_result 解析结果，回退到提交快照（result 未返回期间）
  const displayAnswers = answers ?? submittedAnswers ?? undefined;

  if (questions.length === 0) return null;

  const cancelled = resultBlock?.askUserStatus === "cancelled";
  const isPending = !resultBlock && Boolean(pendingRequest);
  const interactive = isPending && !locked;
  const allSkipped =
    displayAnswers !== undefined &&
    questions.length > 0 &&
    questions.every((_, i) => displayAnswers[String(i)] === ASK_USER_SKIPPED);

  const statusText = cancelled
    ? t("tool.askUser.cancelled")
    : resultBlock || submittedAnswers
      ? allSkipped
        ? t("tool.askUser.skippedItem")
        : t("tool.askUser.answered")
      : isPending
        ? t("tool.askUser.questionsCount", { count: questions.length })
        : t("tool.askUser.interrupted");

  function questionValue(index: number, question: AskUserQuestion): string {
    const type = question.type ?? "choice";
    if (type === "yesno") return choice[index] ?? "";
    if (type === "multiSelect") {
      const picked = [...(multi[index] ?? [])];
      const other = otherText[index]?.trim();
      if (other) picked.push(other);
      return picked.join(", ");
    }
    if (type === "text") return textInput[index]?.trim() ?? "";
    const other = otherOpen[index] ? otherText[index]?.trim() : undefined;
    return other || choice[index] || "";
  }

  function buildAnswers(): AskUserAnswers {
    const out: AskUserAnswers = {};
    questions.forEach((q, i) => {
      const type = q.type ?? "choice";
      if (type === "multiSelect") {
        const picked = [...(multi[i] ?? [])];
        const other = otherText[i]?.trim();
        if (other) picked.push(other);
        out[String(i)] = picked;
      } else {
        out[String(i)] = questionValue(i, q) || ASK_USER_SKIPPED;
      }
    });
    return out;
  }

  const canSubmit =
    interactive && questions.every((q, i) => Boolean(questionValue(i, q)));

  function onSubmit() {
    if (!interactive || !canSubmit) return;
    const built = buildAnswers();
    setSubmittedAnswers(built);
    setLocked(true);
    submitAskUser(pendingRequest.sessionId, block.id, built);
  }

  function onSkip() {
    if (!interactive || !pendingRequest) return;
    setLocked(true);
    const out: AskUserAnswers = {};
    questions.forEach((_, i) => {
      out[String(i)] = ASK_USER_SKIPPED;
    });
    setSubmittedAnswers(out);
    submitAskUser(pendingRequest.sessionId, block.id, out);
  }

  function toggleMulti(index: number, label: string) {
    setMulti((prev) => {
      const picked = prev[index] ?? [];
      return {
        ...prev,
        [index]: picked.includes(label)
          ? picked.filter((value) => value !== label)
          : [...picked, label],
      };
    });
  }

  /** "其他…" 开关 + 自由输入；choice 与 multiSelect 共用。 */
  function renderOther(index: number) {
    return (
      <>
        <button
          type="button"
          disabled={!interactive}
          aria-pressed={Boolean(otherOpen[index])}
          onClick={() =>
            setOtherOpen((prev) => ({ ...prev, [index]: !prev[index] }))
          }
          className={`${OPTION_BASE} ${
            otherOpen[index] ? OPTION_SELECTED : OPTION_IDLE
          }`}
        >
          <span className="text-sm text-text-primary">
            {t("tool.askUser.other")}
          </span>
        </button>
        {otherOpen[index] && (
          <input
            type="text"
            disabled={!interactive}
            maxLength={ASK_USER_INPUT_MAX_LENGTH}
            value={otherText[index] ?? ""}
            placeholder={t("tool.askUser.otherPlaceholder")}
            onChange={(event) =>
              setOtherText((prev) => ({ ...prev, [index]: event.target.value }))
            }
            className={INPUT_BASE}
          />
        )}
      </>
    );
  }

  function renderControls(index: number, question: AskUserQuestion) {
    const type = question.type ?? "choice";
    const options = question.options ?? [];
    if (type === "text") {
      return (
        <input
          type="text"
          disabled={!interactive}
          maxLength={ASK_USER_INPUT_MAX_LENGTH}
          value={textInput[index] ?? ""}
          placeholder={
            question.placeholder || t("tool.askUser.inputPlaceholder")
          }
          onChange={(event) =>
            setTextInput((prev) => ({ ...prev, [index]: event.target.value }))
          }
          className={INPUT_BASE}
        />
      );
    }
    if (type === "yesno") {
      return (
        <div className="flex gap-2">
          {(["Yes", "No"] as const).map((value) => (
            <button
              key={value}
              type="button"
              disabled={!interactive}
              aria-pressed={choice[index] === value}
              onClick={() => setChoice((prev) => ({ ...prev, [index]: value }))}
              className={`${OPTION_BASE} ${
                choice[index] === value ? OPTION_SELECTED : OPTION_IDLE
              }`}
            >
              {t(value === "Yes" ? "tool.askUser.yes" : "tool.askUser.no")}
            </button>
          ))}
        </div>
      );
    }
    if (type === "multiSelect") {
      return (
        <div className="space-y-1.5">
          {options.map((option) => {
            const selected = (multi[index] ?? []).includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                role="checkbox"
                aria-checked={selected}
                disabled={!interactive}
                onClick={() => toggleMulti(index, option.label)}
                className={`${OPTION_BASE} ${selected ? OPTION_SELECTED : OPTION_IDLE}`}
              >
                <span className="text-sm text-text-primary">
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {option.description}
                  </span>
                )}
              </button>
            );
          })}
          {renderOther(index)}
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={choice[index] === option.label}
            disabled={!interactive}
            onClick={() => {
              setChoice((prev) => ({ ...prev, [index]: option.label }));
              setOtherOpen((prev) => ({ ...prev, [index]: false }));
            }}
            className={`${OPTION_BASE} ${
              choice[index] === option.label ? OPTION_SELECTED : OPTION_IDLE
            }`}
          >
            <span className="text-sm text-text-primary">{option.label}</span>
            {option.description && (
              <span className="mt-0.5 block text-xs text-text-muted">
                {option.description}
              </span>
            )}
          </button>
        ))}
        {renderOther(index)}
      </div>
    );
  }

  /** 终态只读：answered 逐题回显答案，cancelled/interrupted 只列选项。 */
  function renderEcho(index: number, question: AskUserQuestion) {
    const value = displayAnswers?.[String(index)];
    const valueText = Array.isArray(value) ? value.join(", ") : value;
    const isYesNo =
      (question.type ?? "choice") === "yesno" &&
      (valueText === "Yes" || valueText === "No");
    if (valueText) {
      return (
        <div className="text-sm text-text-secondary">
          {valueText === ASK_USER_SKIPPED ? (
            <span className="text-text-muted">
              {t("tool.askUser.skippedItem")}
            </span>
          ) : isYesNo ? (
            valueText === "Yes" ? (
              t("tool.askUser.yes")
            ) : (
              t("tool.askUser.no")
            )
          ) : (
            valueText
          )}
        </div>
      );
    }
    const options = question.options ?? [];
    if (options.length === 0) return null;
    return (
      <div className="space-y-1">
        {options.map((option) => (
          <div
            key={option.label}
            className="rounded-lg border border-dashed border-border-subtle px-3 py-1.5 text-xs text-text-muted"
          >
            {option.label}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex">
        <div
          className={`w-1 shrink-0 ${
            isPending ? "bg-accent" : "bg-border-subtle"
          }`}
        />
        <div className="min-w-0 flex-1">
          {/* Header：图标 + 标题 + 题数/终态文案 */}
          <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10">
              <HelpCircle className="h-3.5 w-3.5 text-accent" />
            </div>
            <span className="text-sm font-medium text-text-primary">
              {t("tool.askUser.title")}
            </span>
            <span className="ml-auto text-xs text-text-muted">
              {statusText}
            </span>
          </div>

          {/* 题目列表 */}
          {questions.map((question, index) => (
            <div
              key={index}
              className={
                index > 0 ? "border-t border-dashed border-border-subtle" : ""
              }
            >
              <div className="space-y-2 px-4 py-3">
                {question.header && (
                  <span className="inline-block rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                    {question.header}
                  </span>
                )}
                <p className="text-sm font-medium text-text-primary">
                  {question.question}
                </p>
                {isPending
                  ? renderControls(index, question)
                  : renderEcho(index, question)}
              </div>
            </div>
          ))}

          {/* 底部按钮区：仅 pending 态 */}
          {isPending && (
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-2.5">
              <button
                type="button"
                disabled={!interactive}
                onClick={onSkip}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                {t("tool.askUser.skip")}
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={onSubmit}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {t("tool.askUser.submit")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
