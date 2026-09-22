// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import {
  NEW_SESSION_DRAFT_KEY,
  draftStorageKey,
  readDraft,
  writeDraft,
  type ChatDraft,
} from "../../renderer/utils/chat-draft-store";

function makeDraft(text: string): ChatDraft {
  return { v: 1, text, images: [], files: [], elSelections: [] };
}

function makeSession(id: string): Session {
  return {
    id,
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    sessions: [],
    sessionStates: {},
    activeSessionId: null,
  });
});

describe("会话删除时的草稿剪枝", () => {
  it("removeSession 顺带删掉该会话草稿", () => {
    useAppStore.setState({ sessions: [makeSession("s1"), makeSession("s2")] });
    writeDraft("s1", makeDraft("s1 的草稿"));
    writeDraft("s2", makeDraft("s2 的草稿"));

    useAppStore.getState().removeSession("s1");

    expect(readDraft("s1")).toBeNull();
    expect(readDraft("s2")).not.toBeNull();
  });

  it("removeSessions 批量删掉草稿", () => {
    useAppStore.setState({
      sessions: [makeSession("s1"), makeSession("s2"), makeSession("s3")],
    });
    writeDraft("s1", makeDraft("a"));
    writeDraft("s2", makeDraft("b"));
    writeDraft("s3", makeDraft("c"));

    useAppStore.getState().removeSessions(["s1", "s2"]);

    expect(readDraft("s1")).toBeNull();
    expect(readDraft("s2")).toBeNull();
    expect(readDraft("s3")).not.toBeNull();
  });

  it("setSessions 剪掉不在列表里的草稿，保留 __new__ 槽位", () => {
    writeDraft("alive", makeDraft("还在"));
    writeDraft("ghost", makeDraft("会话已经没了"));
    writeDraft(NEW_SESSION_DRAFT_KEY, makeDraft("欢迎页草稿"));

    useAppStore.getState().setSessions([makeSession("alive")]);

    expect(readDraft("alive")).not.toBeNull();
    expect(readDraft("ghost")).toBeNull();
    expect(readDraft(NEW_SESSION_DRAFT_KEY)).not.toBeNull();
    expect(localStorage.getItem(draftStorageKey("ghost"))).toBeNull();
  });
});
