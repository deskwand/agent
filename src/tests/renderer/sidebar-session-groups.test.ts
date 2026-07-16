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
    expect(result.projectGroups[0].sessions.map(({ id }) => id)).toEqual([
      "backslash",
      "forward-slash",
    ]);
  });

  it("sorts project groups and their sessions by latest activity", () => {
    const result = buildSidebarSessionGroups(
      [
        session("older-in-new-project", {
          isProjectMode: true,
          cwd: "/work/new",
          updatedAt: 20,
        }),
        session("newer-in-new-project", {
          isProjectMode: true,
          cwd: "/work/new",
          updatedAt: 50,
        }),
        session("old-project", {
          isProjectMode: true,
          cwd: "/work/old",
          updatedAt: 40,
        }),
      ],
      "",
    );

    expect(result.projectGroups.map(({ name }) => name)).toEqual([
      "new",
      "old",
    ]);
    expect(result.projectGroups[0].sessions.map(({ id }) => id)).toEqual([
      "newer-in-new-project",
      "older-in-new-project",
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
});
