import { DESKWAND_API_URL } from "../../shared/oauth-config";
import {
  FEEDBACK_PROJECT_SLUG,
  type FeedbackDetailResult,
  type FeedbackIssueSummary,
  type FeedbackListResult,
  type FeedbackReply,
  type FeedbackStatus,
  type FeedbackType,
} from "../../shared/feedback";
import { useAppStore } from "../store";

export class FeedbackApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "FeedbackApiError";
    this.code = code;
    this.status = status;
  }
}

function token(): string | undefined {
  return useAppStore.getState().cloudConfig?.token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const authToken = token();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${DESKWAND_API_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new FeedbackApiError(
      "NETWORK",
      error instanceof Error ? error.message : "Network error",
      0,
    );
  }

  if (!response.ok) {
    let code = "INTERNAL_ERROR";
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* keep defaults */
    }
    throw new FeedbackApiError(code, message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const feedbackApi = {
  list(
    params: { status?: FeedbackStatus; limit?: number; offset?: number } = {},
  ): Promise<FeedbackListResult> {
    const query = new URLSearchParams({ project: FEEDBACK_PROJECT_SLUG });
    if (params.status) query.set("status", params.status);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    return request(`/api/feedback?${query.toString()}`);
  },

  get(id: string): Promise<FeedbackDetailResult> {
    return request(`/api/feedback/${encodeURIComponent(id)}`);
  },

  create(input: {
    type: FeedbackType;
    title: string;
    body: string;
    appVersion?: string;
    platform?: string;
  }): Promise<{ issue: FeedbackIssueSummary }> {
    return request("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        project: FEEDBACK_PROJECT_SLUG,
        ...input,
      }),
    });
  },

  reply(id: string, body: string): Promise<{ reply: FeedbackReply }> {
    return request(`/api/feedback/${encodeURIComponent(id)}/replies`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  },

  remove(id: string): Promise<void> {
    return request(`/api/feedback/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  removeReply(issueId: string, replyId: string): Promise<void> {
    return request(
      `/api/feedback/${encodeURIComponent(issueId)}/replies/${encodeURIComponent(replyId)}`,
      { method: "DELETE" },
    );
  },

  setStatus(
    id: string,
    status: FeedbackStatus,
  ): Promise<{ status: FeedbackStatus }> {
    return request(`/api/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },
};
