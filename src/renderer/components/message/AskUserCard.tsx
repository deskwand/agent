// ask_user 内联卡片：pending 可交互 / answered、cancelled、interrupted 只读。
// 状态判定：findToolResult 找到 result → 解析 answers（answered）或
// askUserStatus（cancelled）；无 result 且 pendingAskUsers 有本块 → pending；
// 无 result 且非 pending → interrupted（会话重启/历史重放）。
// 视觉遵循已确认 mockup：左侧状态色竖条（pending 靛蓝语义 Token bg-primary、
// answered/cancelled 灰）、header 彩色胶囊、题间虚线分隔、底部按钮区。
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import { ASK_USER_SKIPPED } from "../../../shared/ask-user";
import type { AskUserAnswers, AskUserQuestion } from "../../../shared/ask-user";
import type { ContentBlock, ToolUseContent, Message } from "../../types";
import { findToolResult } from "../../utils/tool-result-summary";
import { useAppStore } from "../../store";
import { useIPC } from "../../hooks/useIPC";
import {
  askUserVoiceOwnerPrefix,
  isAskUserRecording,
} from "../../utils/voice/voice-owner";
import { AskUserVoiceField } from "./AskUserVoiceField";
import { Button } from "../app-button";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";

interface AskUserCardProps {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  allMessages: Message[];
}

// ⚠️ 尾部的四条重置**不是**装饰：选项按钮走 `app-button`，而它的 base 是
// `inline-flex items-center justify-center gap-2 whitespace-nowrap` + size `h-9`（cva 默认档）。
// 选项内容是「标题 span + 描述 span」两段文字，落在那套 base 里会变成
// **一行不换行的 flex 行**塞进 **固定 36px 高**的盒子 ⇒ 描述横向溢出、被卡片的
// `overflow-hidden` 裁掉（用户截图：推荐项描述停在「这块是唯…」）。原生 `<button>` 时代
// 描述在标题下一行、盒子随内容长高（实测 57px），这四条把该行为还原回来。
export const OPTION_BASE =
  "w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default h-auto flex-col items-stretch gap-0 whitespace-normal";
export const OPTION_IDLE = "border-border/40 bg-muted hover:bg-accent";
export const OPTION_SELECTED = "border-primary bg-primary/10";
// 选择控件的选项行（choice 的 RadioGroupItem、multiSelect 的原生 checkbox 共用）：
// 外层是 <label>，点文案/描述与点控件等价；箭头和勾选框自己带 role="radio" / type="checkbox"。
// 选项盒子沿用同一套 Token（OPTION_IDLE / OPTION_SELECTED），不新增硬编码色值。
export const OPTION_ROW =
  "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors";

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

  // 本卡有字段正在录音：半截转写不该被提交（与聊天框的 submitBlocked 同一语义）。
  // 读占用者而不是让各字段往上报，省一套回调与多字段次序处理。
  // 必须在早退之前 —— 它是 hook，不能挂在 `questions.length === 0` 那个 return 后面。
  const selfRecording = useAppStore((s) =>
    isAskUserRecording(s.voiceInputOwner, block.id),
  );
  const voiceOwnerPrefix = askUserVoiceOwnerPrefix(block.id);
  // 选项行 id 前缀：RadioGroupItem 与 <label htmlFor> 成对生成，点文案即选中。
  const optionRowId = useId();

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

  /**
   * 勾选的选项按**选项顺序**（不是点选顺序）排列：提交值稳定、与渲染次序一致，
   * 回看答案和测试都不受用户点击先后影响。「其他…」的文本仍接在末尾。
   */
  function orderedMulti(index: number, question: AskUserQuestion): string[] {
    const picked = multi[index] ?? [];
    const ordered = (question.options ?? [])
      .map((option) => option.label)
      .filter((label) => picked.includes(label));
    const other = otherText[index]?.trim();
    if (other) ordered.push(other);
    return ordered;
  }

  function questionValue(index: number, question: AskUserQuestion): string {
    const type = question.type ?? "choice";
    if (type === "yesno") return choice[index] ?? "";
    if (type === "multiSelect") return orderedMulti(index, question).join(", ");
    if (type === "text") return textInput[index]?.trim() ?? "";
    const other = otherOpen[index] ? otherText[index]?.trim() : undefined;
    return other || choice[index] || "";
  }

  function buildAnswers(): AskUserAnswers {
    const out: AskUserAnswers = {};
    questions.forEach((q, i) => {
      const type = q.type ?? "choice";
      if (type === "multiSelect") {
        out[String(i)] = orderedMulti(i, q);
      } else {
        out[String(i)] = questionValue(i, q) || ASK_USER_SKIPPED;
      }
    });
    return out;
  }

  const canSubmit =
    interactive &&
    !selfRecording &&
    questions.every((q, i) => Boolean(questionValue(i, q)));

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
        <Button
          variant="ghost"
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
          <span className="text-sm text-foreground">
            {t("tool.askUser.other")}
          </span>
        </Button>
        {otherOpen[index] && (
          <AskUserVoiceField
            ownerId={`${voiceOwnerPrefix}other:${index}`}
            value={otherText[index] ?? ""}
            onChange={(text) =>
              setOtherText((prev) => ({ ...prev, [index]: text }))
            }
            placeholder={t("tool.askUser.otherPlaceholder")}
            interactive={interactive}
          />
        )}
      </>
    );
  }

  function renderControls(index: number, question: AskUserQuestion) {
    const type = question.type ?? "choice";
    const options = question.options ?? [];
    // 锁定/只读那一帧：控件自带 disabled，行本身也要看不出可点。
    // 可点态**不加手型光标** —— 原生行不换光标（native-cursor-guard 口径），
    // 悬停反馈由背景色承担。
    const rowState = interactive ? "" : "cursor-default opacity-50";
    if (type === "text") {
      return (
        <AskUserVoiceField
          ownerId={`${voiceOwnerPrefix}text:${index}`}
          value={textInput[index] ?? ""}
          onChange={(text) =>
            setTextInput((prev) => ({ ...prev, [index]: text }))
          }
          placeholder={
            question.placeholder || t("tool.askUser.inputPlaceholder")
          }
          interactive={interactive}
        />
      );
    }
    if (type === "yesno") {
      return (
        <div className="flex gap-2">
          {(["Yes", "No"] as const).map((value) => (
            <Button
              variant="ghost"
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
            </Button>
          ))}
        </div>
      );
    }
    if (type === "multiSelect") {
      // 原生 checkbox：官方 `ui/checkbox.tsx` 由另一任务提供，本轮不越界新建。
      // 提交值仍由 buildAnswers 产出 string[]（顺序 = 选项顺序，见 orderedMulti）。
      return (
        <div className="space-y-1.5">
          {options.map((option) => {
            const selected = (multi[index] ?? []).includes(option.label);
            return (
              <label
                key={option.label}
                className={`${OPTION_ROW} ${rowState} ${
                  selected ? OPTION_SELECTED : OPTION_IDLE
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!interactive}
                  onChange={() => toggleMulti(index, option.label)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          {renderOther(index)}
        </div>
      );
    }
    // choice：单选交给 RadioGroup（radiogroup 的可访问名 = 题面，方向键移动并选中）。
    // 不传 orientation —— 见 ui/radio-group.tsx 顶部注释（vertical 会吃掉 ArrowRight）。
    // 「其他…」留在组外：radiogroup 只应拥有 radio，把按钮和输入框塞进组里
    // 既破坏这条 ARIA 契约，也会被辅助技术当成组内容读。
    return (
      <div className="space-y-1.5">
        <RadioGroup
          value={choice[index] ?? ""}
          aria-label={question.question}
          disabled={!interactive}
          onValueChange={(value) => {
            setChoice((prev) => ({ ...prev, [index]: value }));
            setOtherOpen((prev) => ({ ...prev, [index]: false }));
          }}
          className="gap-1.5"
        >
          {options.map((option, optionIndex) => {
            const selected = choice[index] === option.label;
            const radioId = `${optionRowId}-${index}-${optionIndex}`;
            return (
              <label
                key={option.label}
                htmlFor={radioId}
                className={`${OPTION_ROW} ${rowState} ${
                  selected ? OPTION_SELECTED : OPTION_IDLE
                }`}
              >
                <RadioGroupItem
                  id={radioId}
                  value={option.label}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </RadioGroup>
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
        <div className="text-sm text-muted-foreground">
          {valueText === ASK_USER_SKIPPED ? (
            <span className="text-muted-foreground">
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
            className="rounded-lg border border-dashed border-border/40 px-3 py-1.5 text-xs text-muted-foreground"
          >
            {option.label}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex">
        <div
          className={`w-1 shrink-0 ${
            isPending ? "bg-primary" : "bg-border/40"
          }`}
        />
        <div className="min-w-0 flex-1">
          {/* Header：图标 + 标题 + 题数/终态文案 */}
          <div className="flex items-center gap-2.5 border-b border-border/40 px-4 py-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10">
              <HelpCircle className="h-3.5 w-3.5 text-primary-text" />
            </div>
            <span className="text-sm font-medium text-foreground">
              {t("tool.askUser.title")}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {statusText}
            </span>
          </div>

          {/* 题目列表 */}
          {questions.map((question, index) => (
            <div
              key={index}
              className={
                index > 0 ? "border-t border-dashed border-border/40" : ""
              }
            >
              <div className="space-y-2 px-4 py-3">
                {question.header && (
                  <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-text">
                    {question.header}
                  </span>
                )}
                <p className="text-sm font-medium text-foreground">
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
            <div className="flex items-center justify-end gap-2 border-t border-border/40 px-4 py-2.5">
              <Button
                variant="ghost"
                type="button"
                disabled={!interactive}
                onClick={onSkip}
                className="rounded-lg border border-border/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50 h-auto"
              >
                {t("tool.askUser.skip")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={!canSubmit}
                onClick={onSubmit}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 h-auto"
              >
                {t("tool.askUser.submit")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
