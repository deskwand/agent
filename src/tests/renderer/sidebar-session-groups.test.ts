import { describe, expect, it } from "vitest";
import type { Session } from "../../renderer/types";
import { buildSidebarSessionGroups } from "../../renderer/utils/sidebar-session-groups";

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

describe("buildSidebarSessionGroups", () => {
  it("separates ordinary sessions and groups projects by full normalized cwd", () => {
    const result = buildSidebarSessionGroups(
      [
        session("ordinary", { updatedAt: 30 }),
        session("a", {
          isProjectMode: true,
          cwd: "/work/one/app/",
          updatedAt: 20,
        }),
        session("b", {
          isProjectMode: true,
          cwd: "/work/two/app",
          updatedAt: 10,
        }),
      ],
      "",
    );

    expect(result.unscopedSessions.map(({ id }) => id)).toEqual(["ordinary"]);
    expect(
      result.projectGroups.map(({ cwd, name }) => ({ cwd, name })),
    ).toEqual([
      { cwd: "/work/one/app", name: "app" },
      { cwd: "/work/two/app", name: "app" },
    ]);
  });

  it("merges equivalent Windows workspace path variants", () => {
    const result = buildSidebarSessionGroups(
      [
        session("backslash", {
          isProjectMode: true,
          cwd: "C:\\Work\\App",
          updatedAt: 20,
        }),
        session("forward-slash", {
          isProjectMode: true,
          cwd: "c:/work/app/",
          updatedAt: 10,
        }),
      ],
      "",
    );

    expect(result.projectGroups).toHaveLength(1);
    expect(result.projectGroups[0].key).toBe("c:/work/app");
    expect(result.projectGroups[0].sessions.map(({ id }) => id)).toEqual([
      "backslash",
      "forward-slash",
    ]);
  });

  it("sorts project groups by earliest createdAt (stable) and sessions by latest activity", () => {
    const result = buildSidebarSessionGroups(
      [
        session("old-project-first-session", {
          isProjectMode: true,
          cwd: "/work/old",
          createdAt: 1,
          updatedAt: 100,
        }),
        session("new-project-session", {
          isProjectMode: true,
          cwd: "/work/new",
          createdAt: 50,
          updatedAt: 20,
        }),
        session("new-project-later-session", {
          isProjectMode: true,
          cwd: "/work/new",
          createdAt: 30,
          updatedAt: 10,
        }),
      ],
      "",
    );

    // 项目组按 earliestCreatedAt 排序：new(min=30) > old(1)，新项目在上
    expect(result.projectGroups.map(({ name }) => name)).toEqual([
      "new",
      "old",
    ]);
    // 组内会话仍按活跃时间排序
    expect(result.projectGroups[0].sessions.map(({ id }) => id)).toEqual([
      "new-project-session",
      "new-project-later-session",
    ]);
    expect(result.projectGroups[1].sessions.map(({ id }) => id)).toEqual([
      "old-project-first-session",
    ]);
  });

  it("filters by title but expands a project-name match", () => {
    const sessions = [
      session("matching-title", {
        title: "Fix sidebar",
        isProjectMode: true,
        cwd: "/work/deskwand",
        updatedAt: 20,
      }),
      session("other-title", {
        title: "Release notes",
        isProjectMode: true,
        cwd: "/work/deskwand",
        updatedAt: 10,
      }),
    ];

    expect(
      buildSidebarSessionGroups(
        sessions,
        "sidebar",
      ).projectGroups[0].sessions.map(({ id }) => id),
    ).toEqual(["matching-title"]);
    expect(
      buildSidebarSessionGroups(
        sessions,
        "DESKWAND",
      ).projectGroups[0].sessions.map(({ id }) => id),
    ).toEqual(["matching-title", "other-title"]);
  });

  it("ignores archived sessions and treats the default workspace as unscoped", () => {
    const result = buildSidebarSessionGroups(
      [
        session("archived", { archived: true }),
        session("default", {
          isProjectMode: true,
          cwd: "/Users/test/.deskwand/default_working_dir",
        }),
      ],
      "",
    );

    expect(result.unscopedSessions.map(({ id }) => id)).toEqual(["default"]);
    expect(result.projectGroups).toEqual([]);
  });

  it("pins ordinary and project sessions in explicit order", () => {
    const result = buildSidebarSessionGroups(
      [
        session("ordinary-new", { updatedAt: 40 }),
        session("ordinary-pinned", { updatedAt: 10 }),
        session("project-new", {
          isProjectMode: true,
          cwd: "/work/app",
          updatedAt: 30,
        }),
        session("project-pinned", {
          isProjectMode: true,
          cwd: "/work/app",
          updatedAt: 20,
        }),
      ],
      "",
      {
        sessionIds: ["project-pinned", "ordinary-pinned"],
        projectKeys: [],
      },
    );

    expect(result.unscopedSessions.map(({ id }) => id)).toEqual([
      "ordinary-pinned",
      "ordinary-new",
    ]);
    expect(result.projectGroups[0].sessions.map(({ id }) => id)).toEqual([
      "project-pinned",
      "project-new",
    ]);
  });

  it("pins project groups in explicit order before normally sorted groups", () => {
    const result = buildSidebarSessionGroups(
      [
        session("new", {
          isProjectMode: true,
          cwd: "/work/new",
          createdAt: 30,
        }),
        session("old", {
          isProjectMode: true,
          cwd: "/work/old",
          createdAt: 10,
        }),
        session("middle", {
          isProjectMode: true,
          cwd: "/work/middle",
          createdAt: 20,
        }),
      ],
      "",
      {
        sessionIds: [],
        projectKeys: ["/work/old", "/work/middle"],
      },
    );

    expect(result.projectGroups.map(({ key }) => key)).toEqual([
      "/work/old",
      "/work/middle",
      "/work/new",
    ]);
  });

  it("preserves pin order while filtering search results", () => {
    const result = buildSidebarSessionGroups(
      [
        session("first", { title: "Sidebar first", updatedAt: 10 }),
        session("second", { title: "Sidebar second", updatedAt: 20 }),
        session("miss", { title: "Release notes", updatedAt: 30 }),
      ],
      "sidebar",
      {
        sessionIds: ["first", "second"],
        projectKeys: [],
      },
    );

    expect(result.unscopedSessions.map(({ id }) => id)).toEqual([
      "first",
      "second",
    ]);
  });
});
