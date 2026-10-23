// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  feedbackApi,
  FeedbackApiError,
} from "../../renderer/services/feedback-api";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  useAppStore.setState(useAppStore.getInitialState(), true);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("feedbackApi", () => {
  it("injects the project and bearer token into list", async () => {
    useAppStore.setState({
      cloudConfig: {
        serverUrl: "https://api.deskwand.com",
        token: "token-1",
        isLoggedIn: true,
        email: "user@example.com",
        level: "default",
        balanceMicroUsd: 0,
      },
    });
    fetchMock.mockResolvedValue(
      jsonResponse({
        issues: [],
        total: 0,
        viewer: { isLoggedIn: true, isAdmin: false },
      }),
    );

    await feedbackApi.list({ status: "open", limit: 20, offset: 0 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.deskwand.com/api/feedback?project=deskwand&status=open&limit=20&offset=0",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-1",
    );
  });

  it("injects the project into create without a locale", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issue: { id: "i1" } }, 201));

    await feedbackApi.create({
      type: "bug",
      title: "t",
      body: "b",
      appVersion: "1.0.52",
      platform: "darwin",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deskwand.com/api/feedback");
    expect(JSON.parse(String(init.body))).toEqual({
      project: "deskwand",
      type: "bug",
      title: "t",
      body: "b",
      appVersion: "1.0.52",
      platform: "darwin",
    });
  });

  it("maps API errors and network failures", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "RATE_LIMITED", message: "slow down" } },
        429,
      ),
    );
    await expect(feedbackApi.list()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const error = await feedbackApi.list().catch((caught) => caught);
    expect(error).toBeInstanceOf(FeedbackApiError);
    expect(error).toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("handles 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(feedbackApi.remove("i1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deskwand.com/api/feedback/i1");
    expect(init.method).toBe("DELETE");
  });
});
