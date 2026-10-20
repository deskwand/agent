import { describe, expect, it } from "vitest";
import type { Session } from "../../renderer/types";
import {
  SESSION_SEARCH_LIMIT,
  searchSessions,
} from "../../renderer/utils/session-search";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("searchSessions", () => {
  it("lists recent sessions newest first when the query is empty", () => {
    const result = searchSessions(
      [
        session("older", { updatedAt: 10 }),
        session("newer", { updatedAt: 30 }),
        session("middle", { updatedAt: 20 }),
      ],
      "  ",
    );

    expect(result.map(({ session: s }) => s.id)).toEqual([
      "newer",
      "middle",
      "older",
    ]);
  });

  it("keeps only sessions whose title matches", () => {
    const result = searchSessions(
      [
        session("hit", { title: "添加帮助文档入口" }),
        session("miss", { title: "版本发布会话" }),
      ],
      "文档",
    );

    expect(result.map(({ session: s }) => s.id)).toEqual(["hit"]);
  });

  it("returns nothing when no session matches", () => {
    expect(searchSessions([session("a", { title: "你好" })], "zzz")).toEqual(
      [],
    );
  });

  it("drops archived sessions", () => {
    const result = searchSessions(
      [session("archived", { archived: true }), session("visible")],
      "",
    );

    expect(result.map(({ session: s }) => s.id)).toEqual(["visible"]);
  });

  it("labels project sessions with the project folder name and leaves others untagged", () => {
    const result = searchSessions(
      [
        session("ordinary", { updatedAt: 20 }),
        session("project", {
          isProjectMode: true,
          cwd: "/work/eagent/",
          updatedAt: 10,
        }),
      ],
      "",
    );

    expect(
      result.map(({ session: s, projectName }) => [s.id, projectName]),
    ).toEqual([
      ["ordinary", null],
      ["project", "eagent"],
    ]);
  });

  it("caps the list at the number the ⌘1–⌘9 hints can actually reach", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      session(`session-${index}`, { updatedAt: 100 - index }),
    );

    const result = searchSessions(many, "");

    expect(result).toHaveLength(SESSION_SEARCH_LIMIT);
    expect(result.map(({ session: s }) => s.id)).toEqual([
      "session-0",
      "session-1",
      "session-2",
      "session-3",
      "session-4",
      "session-5",
      "session-6",
      "session-7",
      "session-8",
    ]);
  });
});
