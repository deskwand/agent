import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

vi.mock("electron-store", () => {
  class MockStore {
    public store: Record<string, unknown>;
    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...options.defaults };
    }

    set(value: Record<string, unknown>): void {
      this.store = { ...this.store, ...value };
    }
  }

  return { default: MockStore };
});

import { closeDatabase, initDatabase } from "../../main/db/database";
import { SessionManager } from "../../main/session/session-manager";
import { configStore } from "../../main/config/config-store";

beforeEach(() => {
  closeDatabase();
  paths.userData = mkdtempSync(join(tmpdir(), "session-context-window-"));
});

afterEach(() => {
  closeDatabase();
  rmSync(paths.userData, { recursive: true, force: true });
});

it("lists the context window the user configured for the session model", () => {
  configStore.saveProvider({
    profileKey: "custom:relay",
    config: {
      provider: "custom",
      customProtocol: "openai",
      apiKey: "sk-test",
      baseUrl: "https://relay.example.com/v1",
      defaultModel: "qwen-max",
      models: [
        {
          id: "qwen-max",
          label: "Qwen Max",
          source: "custom",
          contextWindow: 250000,
          contextWindowPinned: true,
        },
      ],
      updatedAt: "2026-10-31T00:00:00.000Z",
    },
  });

  const db = initDatabase();
  db.sessions.create({
    id: "session-1",
    title: "hello",
    deskwand_session_id: null,
    openai_thread_id: null,
    status: "idle",
    cwd: null,
    mounted_paths: "[]",
    allowed_tools: "[]",
    memory_enabled: 0,
    is_project_mode: 0,
    provider_profile_key: "custom:relay",
    model: "qwen-max",
    thinking_level: "medium",
    archived: 0,
    archived_at: null,
    completed_at: null,
    pi_session_file: null,
    created_at: 1,
    updated_at: 1,
  });

  const listed = new SessionManager(db, vi.fn()).listSessions();
  expect(listed.contextWindows["session-1"]).toBe(250000);
});
