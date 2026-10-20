import { describe, expect, it } from "vitest";
import type { Session } from "../../renderer/types";
import {
  buildSidebarSessionGroups,
  isSessionBusy,
  isSunkSession,
  listWorkspaceProjects,
  splitSunkSessions,
} from "../../renderer/utils/sidebar-session-groups";

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

  it("completedAt 不参与排序：位置只由 updatedAt（与 pin 次序）决定", () => {
    // 这条是踩雷绳，不是回归测试：它今天就会绿。它盯的是本需求被否掉的那几种做法——
    // 把 completedAt 加进排序比较器、或“已完成统一沉底”。谁这么改，它立刻红。
    const result = buildSidebarSessionGroups(
      [
        session("done-old", { updatedAt: 1, completedAt: 1_700_000_000_000 }),
        session("fresh", { updatedAt: 20 }),
      ],
      "",
    );

    expect(result.unscopedSessions.map(({ id }) => id)).toEqual([
      "fresh",
      "done-old",
    ]);

    // pin 次序仍然压过时间（与上游既有规则一致），完成标记不插手
    const pinned = buildSidebarSessionGroups(
      [
        session("done-pinned", {
          updatedAt: 1,
          completedAt: 1_700_000_000_000,
        }),
        session("fresh", { updatedAt: 20 }),
      ],
      "",
      { sessionIds: ["done-pinned"], projectKeys: [] },
    );

    expect(pinned.unscopedSessions.map(({ id }) => id)).toEqual([
      "done-pinned",
      "fresh",
    ]);
  });
});

describe("isSessionBusy", () => {
  it("hasPendingAskUser 为 true 时视为忙碌", () => {
    expect(isSessionBusy(session("s-1"))).toBe(false);
    expect(isSessionBusy(session("s-1"), [], true)).toBe(true);
  });
});

describe("isSunkSession / splitSunkSessions", () => {
  const MARK = 1_700_000_000_000;
  const sinking = { isBusy: false };

  it("标记之后没再动过的已完成为沉", () => {
    expect(
      isSunkSession(
        session("done", { completedAt: MARK, updatedAt: MARK - 1000 }),
        sinking,
      ),
    ).toBe(true);
  });

  it("没标记的不沉", () => {
    expect(isSunkSession(session("open", { updatedAt: MARK }), sinking)).toBe(
      false,
    );
  });

  it("还在干活的已完成为不沉（运行中 / 待答 ask_user / 后台子代理）", () => {
    // isBusy 的判定归调用方（isSessionBusy 那三个来源），这里只消费结果
    expect(
      isSunkSession(
        session("busy", { completedAt: MARK, updatedAt: MARK - 1000 }),
        { isBusy: true },
      ),
    ).toBe(false);
  });

  // 这里曾经有一条 `it("成员资格不看「谁开着」…")`，已删：它的入参是
  // `{ isBusy: false }` 配 `updatedAt: MARK - 1000`，无论谓词里有没有
  // `activeSessionId` 那一条、有没有时间比较，它都会通过 ⇒ **红不了，就不算覆盖**。
  // 那两层不变量现在由别处守：删掉的那个字段由**类型**管（`SunkSessionContext` 里
  // 已经没有 activeSessionId 可传），行为由 `sidebar-session-completed.test.tsx` 的
  // 「从组里点开一条会话，它不会被弹回主排」等。别把它按原样加回来。

  it("成员资格只看「有标记 + 现在没在干活」—— 时间戳不参与", () => {
    // 曾经这里钉的是「标记之后又被唤起就爬回主排」（比较 updatedAt 与 completedAt）。
    // 它有两个洞：
    // ① `updateSessionStatus(idle)` 无条件写 `updated_at`（session-manager.ts:2292），
    //    所以给**正在跑**的会话打勾时，本轮结束时必然 updatedAt > completedAt
    //    ⇒ 那条永远沉不下去 —— 而「并行时最想收的往往就是还在跑的那个」
    //    正是这个功能的主用途 ✗；
    // ② 时间戳分不开「打勾时那一轮还在飞」与「打勾之后它才被唤醒」—— 两者都是
    //    updatedAt > completedAt，与被删掉的第三条子句同一类错误。
    //
    // 「不能让它躲在折叠堆里干活」由 isBusy 直接兌现，不需要时间戳代理。
    expect(
      isSunkSession(
        session("woken", { completedAt: MARK, updatedAt: MARK + 1000 }),
        sinking,
      ),
    ).toBe(true);
  });

  it("同一毫秒、以及早于标记点的都沉 —— 不再有任何时间比较", () => {
    for (const updatedAt of [MARK - 1, MARK, MARK + 1]) {
      expect(
        isSunkSession(
          session(`t-${updatedAt}`, { completedAt: MARK, updatedAt }),
          {
            isBusy: false,
          },
        ),
      ).toBe(true);
    }
  });

  it("splitSunkSessions 两边都保持传入顺序（置顶次序随原数组带走）", () => {
    const { active, completed } = splitSunkSessions(
      [
        session("a", { updatedAt: 40 }),
        session("b", { completedAt: MARK, updatedAt: 30 }),
        session("c", { completedAt: MARK, updatedAt: 20 }),
        session("d", { updatedAt: 10 }),
      ],
      { isBusy: () => false },
    );
    expect(active.map((s) => s.id)).toEqual(["a", "d"]);
    expect(completed.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("isBusy 是按会话逐个问的，不是一次性结论", () => {
    const { active, completed } = splitSunkSessions(
      [
        session("idle-done", { completedAt: MARK, updatedAt: 1 }),
        session("running-done", { completedAt: MARK, updatedAt: 2 }),
      ],
      {
        isBusy: (s) => s.id === "running-done",
      },
    );
    expect(active.map((s) => s.id)).toEqual(["running-done"]);
    expect(completed.map((s) => s.id)).toEqual(["idle-done"]);
  });
});

describe("listWorkspaceProjects", () => {
  it("忽略普通会话、无 cwd 与空白 cwd 的会话", () => {
    const projects = listWorkspaceProjects([
      session("chat", { cwd: "/work/plain" }),
      session("no-cwd", { isProjectMode: true }),
      session("blank-cwd", { isProjectMode: true, cwd: "   " }),
    ]);

    expect(projects).toEqual([]);
  });

  it("忽略已归档的项目会话", () => {
    const projects = listWorkspaceProjects([
      session("archived", {
        isProjectMode: true,
        cwd: "/work/old",
        archived: true,
      }),
      session("live", { isProjectMode: true, cwd: "/work/alpha" }),
    ]);

    expect(projects).toEqual([{ name: "alpha", cwd: "/work/alpha" }]);
  });

  it("忽略默认工作目录，并把 cwd 的尾斜杠归一化掉", () => {
    const projects = listWorkspaceProjects([
      session("default-dir", {
        isProjectMode: true,
        cwd: "/app/default_working_dir",
      }),
      // 尾斜杠不归一化就会把 "/work/alpha/" 原样交给 workdir.set
      session("live", { isProjectMode: true, cwd: "/work/alpha/" }),
    ]);

    expect(projects).toEqual([{ name: "alpha", cwd: "/work/alpha" }]);
  });

  it("按文件夹名去重（先到先得）并按名排序", () => {
    const projects = listWorkspaceProjects([
      session("beta", { isProjectMode: true, cwd: "/work/beta" }),
      session("alpha-first", { isProjectMode: true, cwd: "/other/alpha" }),
      session("alpha-second", { isProjectMode: true, cwd: "/work/alpha" }),
    ]);

    expect(projects).toEqual([
      { name: "alpha", cwd: "/other/alpha" },
      { name: "beta", cwd: "/work/beta" },
    ]);
  });
});
