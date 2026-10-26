import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Lock, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { formatAppDateTime } from "../../utils/i18n-format";
import { cn } from "../../utils/cn";
import { Button } from "../app-button";
import { Textarea } from "../ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type {
  FeedbackIssueDetail,
  FeedbackViewer,
} from "../../../shared/feedback";
import {
  codePointLength,
  STATUS_LABEL_KEYS,
  TYPE_LABEL_KEYS,
} from "./feedback-format";

function initials(handle: string): string {
  return handle.slice(0, 2).toUpperCase();
}

export function FeedbackDetail({
  issue,
  viewer,
  loading,
  error,
  isLoggedIn,
  onLogin,
  onReply,
  onDeleteIssue,
  onDeleteReply,
  onToggleStatus,
  onRetry,
}: {
  issue: FeedbackIssueDetail | null;
  viewer: FeedbackViewer;
  loading: boolean;
  error: string | null;
  isLoggedIn: boolean;
  onLogin: () => void;
  onReply: (body: string) => Promise<void>;
  onDeleteIssue: () => void;
  onDeleteReply: (replyId: string) => void;
  onToggleStatus: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const replyCountRef = useRef(0);

  useEffect(() => {
    setReply("");
    setSending(false);
  }, [issue?.id]);

  // 切到另一条时把上一轮的回复数归零，避免把「新条目的 0 条」误判成新增。
  useEffect(() => {
    replyCountRef.current = issue?.replies.length ?? 0;
    // 只在切换 issue 时归零；回复变化由下面的滚动 effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id]);

  // 新回复落地后滚到最新一条；状态切换不会改变 replies.length，因此不会跳。
  useEffect(() => {
    const next = issue?.replies.length ?? 0;
    if (next > replyCountRef.current) {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    }
    replyCountRef.current = next;
  }, [issue?.replies.length]);

  if (loading) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center text-xs text-muted-foreground">
        {t("feedback.detail.loading")}
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 text-xs text-destructive">
        <span>{t(error)}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          {t("feedback.detail.retry")}
        </Button>
      </section>
    );
  }

  if (!issue) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center text-xs text-muted-foreground">
        {t("feedback.detail.select")}
      </section>
    );
  }

  const submitReply = async () => {
    const text = reply.trim();
    if (!text || sending || codePointLength(text) > 2000) return;
    setSending(true);
    try {
      await onReply(text);
      setReply("");
    } catch {
      // 视图已经通过全局提示展示错误；保留草稿，方便重试。
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        key={issue.id}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  issue.status === "open"
                    ? "bg-warning/15 text-warning"
                    : "bg-success/15 text-success",
                )}
              >
                {t(STATUS_LABEL_KEYS[issue.status])}
              </span>
              <span className="font-mono">#{issue.id.slice(0, 8)}</span>
              <span>·</span>
              <span>{t(TYPE_LABEL_KEYS[issue.type])}</span>
            </div>
            <div className="flex items-center gap-1">
              {viewer.isAdmin ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onToggleStatus}
                >
                  {issue.status === "open" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  {t(
                    issue.status === "open"
                      ? "feedback.resolve"
                      : "feedback.reopen",
                  )}
                </Button>
              ) : null}
              {viewer.isAdmin || issue.author.isMe ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      aria-label={t("feedback.more")}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="gap-2 text-destructive"
                      onClick={onDeleteIssue}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("feedback.delete.action")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>

          <h1 className="mt-3 text-xl font-semibold leading-7 text-foreground">
            {issue.title}
          </h1>
          <div
            data-testid="feedback-byline"
            className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[9px] font-semibold text-foreground">
              {initials(issue.author.handle)}
            </span>
            <span className="font-medium text-foreground/80">
              {t("feedback.author.handle", { handle: issue.author.handle })}
            </span>
            {issue.author.isMe ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold">
                {t("feedback.author.you")}
              </span>
            ) : null}
            <span>·</span>
            <span>{formatAppDateTime(issue.createdAt)}</span>
            <span>·</span>
            <span className="font-mono">
              {issue.appVersion ?? "—"} · {issue.platform ?? "—"}
            </span>
          </div>

          <div className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-foreground/90">
            {issue.body}
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-center justify-between text-xs">
              <h2 className="font-semibold text-foreground">
                {t("feedback.replySection")}
              </h2>
              <span className="text-muted-foreground">
                {t("feedback.replies", { count: issue.replies.length })}
              </span>
            </div>
            {issue.replies.map((item) => (
              <article
                key={item.id}
                data-testid="feedback-reply"
                className="mt-3 grid grid-cols-[26px_1fr] gap-2.5 border-b border-border/40 pb-3"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[9px] font-semibold text-foreground">
                  {initials(item.author.handle)}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {t("feedback.author.handle", {
                        handle: item.author.handle,
                      })}
                    </span>
                    {item.author.isAdmin ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary-text">
                        {t("feedback.author.maintainer")}
                      </span>
                    ) : null}
                    {item.author.isMe ? (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold">
                        {t("feedback.author.you")}
                      </span>
                    ) : null}
                    <span>·</span>
                    <span>{formatAppDateTime(item.createdAt)}</span>
                    {viewer.isAdmin || item.author.isMe ? (
                      <button
                        type="button"
                        className="ml-auto rounded p-1 text-muted-foreground hover:bg-hover-surface hover:text-destructive"
                        aria-label={t("feedback.delete.replyAction")}
                        onClick={() => onDeleteReply(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-foreground/85">
                    {item.body}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-8 py-3">
        {isLoggedIn ? (
          <div className="mx-auto max-w-3xl rounded-control border border-border bg-card/40 p-3">
            <Textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder={t("feedback.replyPlaceholder")}
              className="min-h-[44px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                {t("feedback.replyPublic")}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={
                  !reply.trim() ||
                  sending ||
                  codePointLength(reply.trim()) > 2000
                }
                onClick={() => void submitReply()}
              >
                {t("feedback.reply")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl items-center gap-2.5">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">
                {t("feedback.loginToReply")}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("feedback.loginHint")}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              onClick={onLogin}
            >
              {t("feedback.login")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
