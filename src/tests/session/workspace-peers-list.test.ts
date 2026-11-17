import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const paths = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    app: { ...(original.app as object), getPath: () => paths.userData },
  };
});

import {
  closeDatabase,
  initDatabase,
  type DatabaseInstance,
} from "../../main/db/database";
import { SessionManager } from "../../main/session/session-manager";

let dir: string;
let db: DatabaseInstance;
let sm: SessionManager;

const CWD = "/work/app";
const NOW = 10_000_000;

/** 直接写库造会话 —— 排序只看 `updated_at` 与 `status`，不走创建流程。 */
function seed(
  id: string,
  options: {
    cwd?: string | null;
    status?: string;
    updatedAt?: number;
    archived?: number;
  } = {},
): void {
  db.sessions.create({
    id,
    title: `会话 ${id}`,
    deskwand_session_id: null,
    openai_thread_id: null,
    status: options.status ?? "idle",
    cwd: options.cwd === undefined ? CWD : options.cwd,
    mounted_paths: "[]",
    allowed_tools: "[]",
    memory_enabled: 0,
    is_project_mode: 1,
    provider_profile_key: null,
    model: null,
    thinking_level: "medium",
    archived: options.archived ?? 0,
    archived_at: null,
    completed_at: null,
    pi_session_file: null,
    created_at: options.updatedAt ?? 1,
    updated_at: options.updatedAt ?? 1,
  });
}

beforeEach(() => {
  closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "workspace-peers-list-"));
  paths.userData = dir;
  db = initDatabase(join(dir, "cowork.db"));
  sm = new SessionManager(db, () => {});
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("SessionManager.listWorkspacePeers", () => {
  it("只取同 cwd 的前 5 个、按最近活动倒序，并如实回报被丢掉的个数", () => {
    seed("self", { updatedAt: 9_000 });
    seed("peer-a", { updatedAt: 1_000 });
    seed("peer-b", { updatedAt: 6_000 });
    seed("peer-c", { updatedAt: 2_000 });
    seed("peer-d", { updatedAt: 5_000 });
    seed("peer-e", { updatedAt: 3_000 });
    seed("peer-f", { updatedAt: 4_000 });
    seed("elsewhere", { cwd: "/work/other", updatedAt: 9_500 });
    seed("archived", { archived: 1, updatedAt: 9_600 });

    const result = sm.listWorkspacePeers("self", CWD, NOW);

    expect(result.peers.map((peer) => peer.title)).toEqual([
      "会话 peer-b",
      "会话 peer-d",
      "会话 peer-f",
      "会话 peer-e",
      "会话 peer-c",
    ]);
    // 同 cwd 的候选是 peer-a..f 共 6 个，列出 5 个 ⇒ 丢 1 个，必须说出来
    expect(result.omittedCount).toBe(1);
  });

  it("把活动条目折进快照（文件 / 命令 / 待办）", () => {
    seed("self");
    seed("peer", { updatedAt: 500 });

    sm.recordToolActivity("peer", "write", { path: `${CWD}/src/a.ts` });
    sm.recordToolActivity("peer", "bash", { command: "npm test" });
    sm.recordToolActivity("peer", "todo_write", {
      todos: [{ content: "补测试", status: "in_progress" }],
    });

    const [peer] = sm.listWorkspacePeers("self", CWD, NOW).peers;

    expect(peer.files).toEqual([`${CWD}/src/a.ts`]);
    expect(peer.bashCommands).toEqual(["npm test"]);
    expect(peer.plan).toEqual([{ content: "补测试", status: "in_progress" }]);
  });

  it("status 为 running 的会话在快照里算 running", () => {
    seed("self");
    seed("peer", { status: "running" });

    const [peer] = sm.listWorkspacePeers("self", CWD, NOW).peers;

    expect(peer.isRunning).toBe(true);
  });

  it("记录的活动会按时间窗剪掉过期的", () => {
    seed("self");
    seed("peer");

    sm.recordToolActivity("peer", "write", { path: `${CWD}/src/old.ts` });

    // 时间窗（30 分钟）之后再查：旧记录不应再出现
    const [peer] = sm.listWorkspacePeers(
      "self",
      CWD,
      Date.now() + 31 * 60 * 1000,
    ).peers;

    expect(peer.files).toEqual([]);
  });
});
