import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { feedbackApi, FeedbackApiError } from "../../services/feedback-api";
import type {
  FeedbackIssueDetail,
  FeedbackIssueSummary,
  FeedbackStatus,
  FeedbackType,
  FeedbackViewer,
} from "../../../shared/feedback";
import { FeedbackList, type FeedbackFilter } from "./FeedbackList";
import { FeedbackDetail } from "./FeedbackDetail";
import { FeedbackComposeDialog } from "./FeedbackComposeDialog";
import { ConfirmDialog } from "../ConfirmDialog";

const PAGE_SIZE = 20;

function noticeFor(error: unknown): string {
  if (error instanceof FeedbackApiError) {
    if (error.status === 401) return "feedback.error.sessionExpired";
    if (error.status === 403) return "feedback.error.forbidden";
    if (error.status === 429) return "feedback.error.rateLimited";
  }
  return "feedback.error.generic";
}

export function FeedbackView() {
  const { t } = useTranslation();
  const cloudConfig = useAppStore((state) => state.cloudConfig);
  const setCloudConfig = useAppStore((state) => state.setCloudConfig);
  const setShowLoginModal = useAppStore((state) => state.setShowLoginModal);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setGlobalNotice = useAppStore((state) => state.setGlobalNotice);

  const [issues, setIssues] = useState<FeedbackIssueSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [viewer, setViewer] = useState<FeedbackViewer>({
    isLoggedIn: false,
    isAdmin: false,
  });
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const filterRef = useRef<FeedbackFilter>(filter);
  const [detail, setDetail] = useState<FeedbackIssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "issue" | "reply";
    id: string;
  } | null>(null);
  /** 只让最后一次列表请求落地，避免快速切筛选时旧响应覆盖新列表。 */
  const listRequestRef = useRef(0);

  const isLoggedIn = Boolean(cloudConfig?.isLoggedIn && cloudConfig.token);

  const showError = useCallback(
    (caught: unknown) => {
      if (caught instanceof FeedbackApiError && caught.status === 401) {
        setCloudConfig(null);
        setShowLoginModal(true);
      }
      setGlobalNotice({
        id: `feedback-error-${Date.now()}`,
        message: "",
        messageKey: noticeFor(caught),
        type: "error",
      });
    },
    [setCloudConfig, setGlobalNotice, setShowLoginModal],
  );

  const loadList = useCallback(
    async (offset: number, options: { keepSelection?: boolean } = {}) => {
      const requestId = ++listRequestRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await feedbackApi.list({
          status: filter === "all" ? undefined : filter,
          limit: PAGE_SIZE,
          offset,
        });
        if (requestId !== listRequestRef.current) return;
        setIssues((current) => {
          if (offset === 0) return result.issues;
          const seen = new Set(current.map((issue) => issue.id));
          return [
            ...current,
            ...result.issues.filter((issue) => !seen.has(issue.id)),
          ];
        });
        setTotal(result.total);
        setViewer(result.viewer);
        if (offset === 0) {
          setSelectedId((current) => {
            if (options.keepSelection && current) return current;
            if (
              current &&
              result.issues.some((issue) => issue.id === current)
            ) {
              return current;
            }
            return result.issues[0]?.id ?? null;
          });
        }
      } catch (caught) {
        if (requestId !== listRequestRef.current) return;
        setError(noticeFor(caught));
        showError(caught);
      } finally {
        if (requestId === listRequestRef.current) setLoading(false);
      }
    },
    [filter, showError],
  );

  useEffect(() => {
    const keepSelection = filterRef.current === filter;
    filterRef.current = filter;
    void loadList(0, { keepSelection });
  }, [loadList, isLoggedIn, reloadToken, filter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    feedbackApi
      .get(selectedId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result.issue);
        setViewer(result.viewer);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof FeedbackApiError && caught.status === 404) {
          // 被维护者删了：从列表移除、清空选中，回到「选择一条反馈」的空态。
          setIssues((current) =>
            current.filter((issue) => issue.id !== selectedId),
          );
          setTotal((value) => Math.max(0, value - 1));
          setDetail(null);
          setSelectedId(null);
          setDetailError(null);
          setGlobalNotice({
            id: "feedback-deleted-elsewhere",
            message: "",
            messageKey: "feedback.error.deleted",
            type: "info",
          });
          return;
        }
        setDetailError(noticeFor(caught));
        showError(caught);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailNonce, showError, setGlobalNotice]);

  const handleReply = async (body: string) => {
    if (!detail) return;
    const issueId = detail.id;
    try {
      const result = await feedbackApi.reply(issueId, body);
      setDetail((current) =>
        current?.id === issueId
          ? {
              ...current,
              replies: [...current.replies, result.reply],
              replyCount: current.replyCount + 1,
            }
          : current,
      );
      setIssues((current) =>
        current.map((issue) =>
          issue.id === issueId
            ? { ...issue, replyCount: issue.replyCount + 1 }
            : issue,
        ),
      );
    } catch (caught) {
      showError(caught);
      throw caught;
    }
  };

  const handleDeleteIssue = async () => {
    if (!detail || deleteTarget?.kind !== "issue") return;
    const issueId = detail.id;
    try {
      await feedbackApi.remove(issueId);
      const remaining = issues.filter((item) => item.id !== issueId);
      setIssues(remaining);
      setTotal((value) => Math.max(0, value - 1));
      setSelectedId((current) =>
        current === issueId ? (remaining[0]?.id ?? null) : current,
      );
      setDetail((current) => (current?.id === issueId ? null : current));
      setDeleteTarget(null);
      setGlobalNotice({
        id: "feedback-deleted",
        message: "",
        messageKey: "feedback.notice.deleted",
        type: "success",
      });
    } catch (caught) {
      setDeleteTarget(null);
      showError(caught);
    }
  };

  const handleDeleteReply = async () => {
    if (!detail || deleteTarget?.kind !== "reply") return;
    const issueId = detail.id;
    const replyId = deleteTarget.id;
    try {
      await feedbackApi.removeReply(issueId, replyId);
      setDetail((current) =>
        current?.id === issueId
          ? {
              ...current,
              replies: current.replies.filter((reply) => reply.id !== replyId),
              replyCount: Math.max(0, current.replyCount - 1),
            }
          : current,
      );
      setIssues((current) =>
        current.map((item) =>
          item.id === issueId
            ? { ...item, replyCount: Math.max(0, item.replyCount - 1) }
            : item,
        ),
      );
      setDeleteTarget(null);
    } catch (caught) {
      setDeleteTarget(null);
      showError(caught);
    }
  };

  const handleToggleStatus = async () => {
    if (!detail) return;
    const issueId = detail.id;
    const next: FeedbackStatus = detail.status === "open" ? "resolved" : "open";
    try {
      await feedbackApi.setStatus(issueId, next);
      setDetail((current) =>
        current?.id === issueId ? { ...current, status: next } : current,
      );
      const updated = issues.map((item) =>
        item.id === issueId ? { ...item, status: next } : item,
      );
      if (filter !== "all" && filter !== next) {
        const remaining = updated.filter((item) => item.id !== issueId);
        setIssues(remaining);
        setSelectedId((current) =>
          current === issueId ? (remaining[0]?.id ?? null) : current,
        );
        setDetail((current) => (current?.id === issueId ? null : current));
      } else {
        setIssues(updated);
      }
    } catch (caught) {
      showError(caught);
    }
  };

  const handleNew = () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    setComposeOpen(true);
  };

  const handleCreate = async (input: {
    type: FeedbackType;
    title: string;
    body: string;
  }) => {
    setComposeBusy(true);
    try {
      const version = await window.electronAPI?.getVersion?.();
      const created = await feedbackApi.create({
        ...input,
        appVersion: version,
        platform: window.electronAPI?.platform,
      });
      setComposeOpen(false);
      setFilter("all");
      setSelectedId(created.issue.id);
      setReloadToken((value) => value + 1);
      setGlobalNotice({
        id: "feedback-created",
        message: "",
        messageKey: "feedback.notice.created",
        type: "success",
      });
    } catch (caught) {
      // 401 已由 showError 清登录态；其他错误保留弹窗和草稿，方便重试。
      if (caught instanceof FeedbackApiError && caught.status === 401) {
        setComposeOpen(false);
      }
      showError(caught);
    } finally {
      setComposeBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <FeedbackList
        issues={issues}
        selectedId={selectedId}
        filter={filter}
        loading={loading}
        error={error}
        total={total}
        onFilter={setFilter}
        onSelect={setSelectedId}
        onRefresh={() => void loadList(0, { keepSelection: true })}
        onLoadMore={() => void loadList(issues.length)}
        onNew={handleNew}
        onBack={() => setActiveView("chat")}
      />
      <FeedbackDetail
        issue={detail}
        viewer={viewer}
        loading={detailLoading}
        error={detailError}
        isLoggedIn={isLoggedIn}
        onLogin={() => setShowLoginModal(true)}
        onReply={handleReply}
        onDeleteIssue={() =>
          setDeleteTarget({ kind: "issue", id: detail?.id ?? "" })
        }
        onDeleteReply={(replyId) =>
          setDeleteTarget({ kind: "reply", id: replyId })
        }
        onToggleStatus={() => void handleToggleStatus()}
        onRetry={() => setDetailNonce((value) => value + 1)}
      />
      <FeedbackComposeDialog
        open={composeOpen}
        busy={composeBusy}
        onOpenChange={setComposeOpen}
        onSubmit={handleCreate}
      />
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t(
          deleteTarget?.kind === "reply"
            ? "feedback.delete.replyTitle"
            : "feedback.delete.title",
        )}
        description={t("feedback.delete.body")}
        confirmLabel={t("feedback.delete.confirm")}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget?.kind === "reply") void handleDeleteReply();
          else void handleDeleteIssue();
        }}
      />
    </div>
  );
}
