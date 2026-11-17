import { describe, expect, it } from "vitest";

import {
  MAX_PEERS,
  PEER_WINDOW_MS,
  extractPeerActivity,
  createWorkspacePeersTool,
  formatPeersReport,
  pruneActivity,
  selectWorkspacePeerIds,
  toPeerActivityEntry,
  type PeerActivityEntry,
  type WorkspacePeerSnapshot,
  type WorkspacePeersResult,
} from "../../main/agent/tools/workspace-peers";

describe("toPeerActivityEntry", () => {
  it("write 只留 path，绝不带 content", () => {
    const entry = toPeerActivityEntry(
      "write",
      { path: "src/a.ts", content: "sk-live-secret-value" },
      1_000,
    );
    expect(entry).toEqual({
      toolName: "write",
      path: "src/a.ts",
      timestamp: 1_000,
    });
    expect(JSON.stringify(entry)).not.toContain("sk-live-secret");
  });

  it("edit 同样只留 path", () => {
    expect(
      toPeerActivityEntry(
        "edit",
        { path: "src/b.ts", old_string: "旧代码", new_string: "新代码" },
        2_000,
      ),
    ).toEqual({ toolName: "edit", path: "src/b.ts", timestamp: 2_000 });
  });

  it("缺 path 的写入不记", () => {
    expect(toPeerActivityEntry("write", { content: "x" }, 1)).toBeNull();
    expect(toPeerActivityEntry("edit", "not-an-object", 1)).toBeNull();
  });

  it("bash 只留首行，并截断到 80 字符", () => {
    const entry = toPeerActivityEntry(
      "bash",
      { command: `npm test ${"x".repeat(200)}\necho second-line` },
      3_000,
    );
    expect(entry?.command).toHaveLength(80);
    expect(entry?.command).not.toContain("\n");
    expect(toPeerActivityEntry("bash", { command: "   " }, 1)).toBeNull();
  });

  it("todo_write 只留未完成的待办，最多 5 条", () => {
    const todos = Array.from({ length: 8 }, (_, i) => ({
      content: `待办 ${i}`,
      status: i % 2 === 0 ? "pending" : "completed",
    }));
    const entry = toPeerActivityEntry("todo_write", { todos }, 4_000);
    expect(entry?.plan).toHaveLength(4);
    expect(entry?.plan?.every((item) => item.status === "pending")).toBe(true);
  });

  it("未知工具回 null —— 活动表不是全量调用日志", () => {
    expect(toPeerActivityEntry("read", { path: "src/a.ts" }, 1)).toBeNull();
    expect(toPeerActivityEntry("web_search", { query: "x" }, 1)).toBeNull();
  });
});

describe("pruneActivity", () => {
  const entry = (timestamp: number): PeerActivityEntry => ({
    toolName: "write",
    path: `src/${timestamp}.ts`,
    timestamp,
  });

  it("丢掉时间窗外的条目", () => {
    const now = 10 * PEER_WINDOW_MS;
    const kept = pruneActivity(
      [entry(now - PEER_WINDOW_MS - 1), entry(now - 1_000), entry(now)],
      now,
    );
    expect(kept.map((item) => item.timestamp)).toEqual([now - 1_000, now]);
  });

  it("只保留最近 200 条", () => {
    const now = 100_000;
    const entries = Array.from({ length: 260 }, (_, i) => entry(now - i));
    const kept = pruneActivity(entries.reverse(), now);
    expect(kept).toHaveLength(200);
    expect(kept[kept.length - 1].timestamp).toBe(now);
  });
});

describe("selectWorkspacePeerIds", () => {
  const sessions = [
    { id: "self", cwd: "/work/deskwand" },
    { id: "peer", cwd: "/work/deskwand" },
    { id: "trailing", cwd: "/work/deskwand/" },
    { id: "other", cwd: "/work/other" },
    { id: "archived", cwd: "/work/deskwand", archived: true },
    { id: "no-cwd" },
  ];

  it("只留同目录的别人，排除自己、归档与无 cwd", () => {
    expect(selectWorkspacePeerIds(sessions, "self", "/work/deskwand")).toEqual([
      "peer",
      "trailing",
    ]);
  });

  it("Windows 的大小写与分隔符差异算同一目录", () => {
    const windowsSessions = [
      { id: "a", cwd: "C:\\Work\\App" },
      { id: "b", cwd: "c:/work/app" },
      { id: "c", cwd: "C:\\Work\\Other" },
    ];
    expect(
      selectWorkspacePeerIds(windowsSessions, "self", "C:/Work/App"),
    ).toEqual(["a", "b"]);
  });

  it("自身 cwd 为空时不给任何候选", () => {
    expect(selectWorkspacePeerIds(sessions, "self", "   ")).toEqual([]);
  });
});

function activityEntry(
  overrides: Partial<PeerActivityEntry>,
): PeerActivityEntry {
  return { toolName: "write", path: "src/a.ts", timestamp: 1, ...overrides };
}

function snapshotOf(entries: PeerActivityEntry[]): WorkspacePeerSnapshot {
  return extractPeerActivity({
    title: "并行会话",
    isRunning: true,
    lastActivityAt: 5_000,
    entries,
  });
}

describe("extractPeerActivity", () => {
  it("文件去重保序", () => {
    expect(
      snapshotOf([
        activityEntry({ path: "src/a.ts", timestamp: 1 }),
        activityEntry({ toolName: "edit", path: "src/a.ts", timestamp: 2 }),
        activityEntry({ path: "src/b.ts", timestamp: 3 }),
      ]).files,
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("文件超过 10 条时保留最近的 10 条，并回报总数", () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      activityEntry({ path: `src/f${i}.ts`, timestamp: i }),
    );
    const snapshot = snapshotOf(entries);
    expect(snapshot.files).toHaveLength(10);
    // 冲突最可能来自最近的改动：被丢掉的必须是**最早**的两条
    expect(snapshot.files[0]).toBe("src/f2.ts");
    expect(snapshot.files[9]).toBe("src/f11.ts");
    expect(snapshot.fileCount).toBe(12);
  });

  it("bash 取最近 3 条", () => {
    const entries = ["git status", "git diff", "git log", "npm test"].map(
      (command, i) =>
        activityEntry({
          toolName: "bash",
          command,
          path: undefined,
          timestamp: i,
        }),
    );
    expect(snapshotOf(entries).bashCommands).toEqual([
      "git diff",
      "git log",
      "npm test",
    ]);
  });

  it("待办取最后一条 todo_write", () => {
    const result = snapshotOf([
      activityEntry({
        toolName: "todo_write",
        path: undefined,
        plan: [{ content: "旧待办", status: "pending" }],
        timestamp: 1,
      }),
      activityEntry({
        toolName: "todo_write",
        path: undefined,
        plan: [
          { content: "迁移 token 校验", status: "in_progress" },
          { content: "补测试", status: "pending" },
        ],
        timestamp: 2,
      }),
    ]);
    expect(result.plan).toEqual([
      { content: "迁移 token 校验", status: "in_progress" },
      { content: "补测试", status: "pending" },
    ]);
  });

  it("最后一条待办清空时给空数组；从未用过待办时给 null", () => {
    expect(
      snapshotOf([
        activityEntry({
          toolName: "todo_write",
          path: undefined,
          plan: [],
          timestamp: 1,
        }),
      ]).plan,
    ).toEqual([]);
    expect(snapshotOf([activityEntry({})]).plan).toBeNull();
  });
});

const MAX_FILES_PER_SNAPSHOT_FOR_TEST = 10;
const NOW = 60 * 60 * 1000;

function snapshot(
  overrides: Partial<WorkspacePeerSnapshot> = {},
): WorkspacePeerSnapshot {
  const files = overrides.files ?? [];
  return {
    title: "重构鉴权流程",
    isRunning: true,
    lastActivityAt: NOW - 2 * 60 * 1000,
    files,
    fileCount: files.length,
    bashCommands: [],
    plan: null,
    ...overrides,
  };
}

describe("formatPeersReport", () => {
  it("没有 peer 时给明确一句话，不是空串", () => {
    expect(
      formatPeersReport({
        selfCwd: "/work/deskwand",
        peers: [],
        omittedCount: 0,
        now: NOW,
      }),
    ).toBe("No other session is working in /work/deskwand (window 30m).");
  });

  it("表头带会话数与运行中数量，逐条列出状态", () => {
    const report = formatPeersReport({
      selfCwd: "/work/deskwand",
      peers: [snapshot(), snapshot({ title: "修 typos", isRunning: false })],
      omittedCount: 0,
      now: NOW,
    });
    expect(report).toContain("2 others, 1 running (window 30m)");
    expect(report).toContain("1. 重构鉴权流程 — running, last activity 2m ago");
    expect(report).toContain("2. 修 typos — idle, last activity 2m ago");
  });

  it("cwd 内的路径显示成相对路径，窗外路径原样", () => {
    const report = formatPeersReport({
      selfCwd: "/work/deskwand",
      peers: [
        snapshot({
          files: [
            "/work/deskwand/src/main/auth.ts",
            "/elsewhere/config.ts",
            "/workspace/src/sandboxed.ts",
          ],
        }),
      ],
      omittedCount: 0,
      now: NOW,
    });
    expect(report).toContain(
      "touched: src/main/auth.ts, /elsewhere/config.ts, src/sandboxed.ts",
    );
  });

  it("窗内没动文件时说明没动文件，而不是留空", () => {
    const report = formatPeersReport({
      selfCwd: "/work/deskwand",
      peers: [snapshot({ bashCommands: ["npm test -- auth"] })],
      omittedCount: 0,
      now: NOW,
    });
    expect(report).toContain("no file activity in 30m");
    expect(report).toContain("bash: npm test -- auth");
  });

  it("待办三态：未完成项列表 / all items done / 整行不出现", () => {
    const list = formatPeersReport({
      selfCwd: "/w",
      peers: [
        snapshot({
          plan: [
            { content: "迁移 token 校验", status: "in_progress" },
            { content: "补测试", status: "pending" },
          ],
        }),
      ],
      omittedCount: 0,
      now: NOW,
    });
    expect(list).toContain(
      "plan: [in_progress] 迁移 token 校验 · [pending] 补测试",
    );

    const done = formatPeersReport({
      selfCwd: "/w",
      peers: [snapshot({ plan: [] })],
      omittedCount: 0,
      now: NOW,
    });
    expect(done).toContain("plan: all items done");

    const never = formatPeersReport({
      selfCwd: "/w",
      peers: [snapshot({ plan: null })],
      omittedCount: 0,
      now: NOW,
    });
    expect(never).not.toContain("plan:");
  });

  it("被 MAX_PEERS 丢掉的会话要如实说明", () => {
    const report = formatPeersReport({
      selfCwd: "/w",
      peers: [snapshot()],
      omittedCount: 2,
      now: NOW,
    });
    expect(report).toContain("… and 2 more sessions in this workspace");
  });

  it("总长超过 2000 字符时截断并留省略号", () => {
    const longFiles = Array.from(
      { length: MAX_FILES_PER_SNAPSHOT_FOR_TEST },
      (_, i) =>
        `/w/src/very-long-directory-name/file-${i}-${"y".repeat(60)}.ts`,
    );
    const peers = Array.from({ length: MAX_PEERS }, (_, i) =>
      snapshot({ title: `第 ${i + 1} 个会话`, files: longFiles }),
    );
    const report = formatPeersReport({
      selfCwd: "/w",
      peers,
      omittedCount: 0,
      now: NOW,
    });
    expect(report.length).toBeLessThanOrEqual(2_000);
    expect(report.endsWith("…")).toBe(true);
  });
});

describe("createWorkspacePeersTool", () => {
  async function run(listPeers: () => WorkspacePeersResult): Promise<string> {
    const tool = createWorkspacePeersTool({
      selfSessionId: "self",
      selfCwd: "/work/deskwand",
      listPeers,
      now: () => NOW,
    });
    const result = await tool.execute(
      "call-1",
      {},
      undefined,
      undefined,
      {} as never,
    );
    const block = result.content[0] as { type: string; text?: string };
    return block.text ?? "";
  }

  it("把注入的 peer 渲染成报告", async () => {
    const text = await run(() => ({
      peers: [snapshot({ files: ["src/a.ts"] })],
      omittedCount: 0,
    }));
    expect(text).toContain("Peers in /work/deskwand");
    expect(text).toContain("touched: src/a.ts");
  });

  it("绝不泄漏别的会话写过的正文或工具输出", async () => {
    const entries = [
      toPeerActivityEntry(
        "write",
        { path: "/work/deskwand/src/a.ts", content: "sk-live-secret-value" },
        NOW,
      ),
      toPeerActivityEntry(
        "bash",
        { command: "npm test -- auth", output: "sk-live-secret-value" },
        NOW,
      ),
    ].filter((entry): entry is PeerActivityEntry => entry !== null);

    const text = await run(() => ({
      peers: [
        extractPeerActivity({
          title: "并行会话",
          isRunning: true,
          lastActivityAt: NOW,
          entries,
        }),
      ],
      omittedCount: 0,
    }));
    expect(text).not.toContain("sk-live-secret");
    expect(text).toContain("src/a.ts");
    expect(text).toContain("npm test -- auth");
  });

  it("数据源抛错时回一行失败说明，不抛出去", async () => {
    const text = await run(() => {
      throw new Error("database is locked");
    });
    expect(text).toBe("workspace_peers failed: database is locked");
  });
});

describe("formatPeersReport — 文件被折叠时如实说明", () => {
  it("只列最近 10 个文件时标出总数", () => {
    const report = formatPeersReport({
      selfCwd: "/w",
      peers: [
        snapshot({
          files: ["/w/src/new-1.ts", "/w/src/new-2.ts"],
          fileCount: 12,
        }),
      ],
      omittedCount: 0,
      now: NOW,
    });
    expect(report).toContain(
      "touched (last 2 of 12): src/new-1.ts, src/new-2.ts",
    );
  });

  it("没被折叠时不出现括号", () => {
    const report = formatPeersReport({
      selfCwd: "/w",
      peers: [snapshot({ files: ["/w/src/a.ts"] })],
      omittedCount: 0,
      now: NOW,
    });
    expect(report).toContain("touched: src/a.ts");
    expect(report).not.toContain("last 1 of 1");
  });
});
