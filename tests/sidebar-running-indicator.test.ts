import { describe, expect, it } from "vitest";
import type { Session } from "../src/renderer/types";
import {
  isSessionBusy,
  type SidebarBackgroundAgent,
} from "../src/renderer/utils/sidebar-session-groups";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    title: "test",
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeAgent(
  overrides: Partial<SidebarBackgroundAgent> = {},
): SidebarBackgroundAgent {
  return {
    id: "a1",
    type: "Explore",
    description: "research",
    status: "running",
    ...overrides,
  };
}

describe("isSessionBusy", () => {
  it("returns true when the main session status is running", () => {
    expect(isSessionBusy(makeSession({ status: "running" }))).toBe(true);
  });

  it("returns true while a background agent is running", () => {
    expect(isSessionBusy(makeSession({ status: "idle" }), [makeAgent()])).toBe(
      true,
    );
  });

  it("returns false when idle and no background agents exist", () => {
    expect(isSessionBusy(makeSession({ status: "idle" }))).toBe(false);
    expect(isSessionBusy(makeSession({ status: "idle" }), [])).toBe(false);
  });

  it("returns false when the only background agent is done (1s retention window)", () => {
    expect(
      isSessionBusy(makeSession({ status: "idle" }), [
        makeAgent({ status: "done" }),
      ]),
    ).toBe(false);
  });

  it("returns true when one agent is done but another still runs", () => {
    expect(
      isSessionBusy(makeSession({ status: "idle" }), [
        makeAgent({ id: "a1", status: "done" }),
        makeAgent({ id: "a2" }),
      ]),
    ).toBe(true);
  });

  it("returns false for completed/error session with no background agents", () => {
    expect(isSessionBusy(makeSession({ status: "completed" }))).toBe(false);
    expect(isSessionBusy(makeSession({ status: "error" }))).toBe(false);
  });
});
