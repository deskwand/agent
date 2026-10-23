export const FEEDBACK_PROJECT_SLUG = "deskwand";

export type FeedbackType = "bug" | "feature" | "other";
export type FeedbackStatus = "open" | "resolved";

export interface FeedbackAuthor {
  handle: string;
  isAdmin: boolean;
  isMe: boolean;
}

export interface FeedbackIssueSummary {
  id: string;
  type: FeedbackType;
  title: string;
  status: FeedbackStatus;
  author: FeedbackAuthor;
  appVersion: string | null;
  platform: string | null;
  replyCount: number;
  createdAt: string;
}

export interface FeedbackReply {
  id: string;
  body: string;
  author: FeedbackAuthor;
  createdAt: string;
}

export interface FeedbackIssueDetail extends FeedbackIssueSummary {
  body: string;
  replies: FeedbackReply[];
}

export interface FeedbackViewer {
  isLoggedIn: boolean;
  isAdmin: boolean;
}

export interface FeedbackListResult {
  issues: FeedbackIssueSummary[];
  total: number;
  viewer: FeedbackViewer;
}

export interface FeedbackDetailResult {
  issue: FeedbackIssueDetail;
  viewer: FeedbackViewer;
}
