import { beforeEach, describe, expect, it } from "vitest";
import { selectVisibleIdeas, useAppStore } from "../../renderer/store";
import type { IdeaSummary } from "../../shared/ideas";

const idea = (name: string, status: "inbox" | "archived"): IdeaSummary => ({
  name,
  excerpt: name,
  createdAt: 1,
  status,
  archivedAt: null,
  sourceSessionId: null,
  sourceView: null,
});

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
});

describe("灵感 slice", () => {
  it("默认值齐全", () => {
    const s = useAppStore.getState();
    expect(s.ideasInbox).toEqual([]);
    expect(s.ideasArchived).toEqual([]);
    expect(s.ideasSkipped).toBe(0);
    // 只有一个列表：归档项默认收起，不是"当前在哪个列表"。
    expect(s.showArchivedIdeas).toBe(false);
    expect(s.ideasSelectedName).toBeNull();
    expect(s.ideaCaptureOpen).toBe(false);
    expect(s.pendingEditorAppend).toBeNull();
  });

  it("开关 / 选中 / 浮层", () => {
    const store = useAppStore.getState();
    store.setShowArchivedIdeas(true);
    expect(useAppStore.getState().showArchivedIdeas).toBe(true);
    store.selectIdea("某条");
    expect(useAppStore.getState().ideasSelectedName).toBe("某条");
    store.openIdeaCapture();
    expect(useAppStore.getState().ideaCaptureOpen).toBe(true);
    store.closeIdeaCapture();
    expect(useAppStore.getState().ideaCaptureOpen).toBe(false);
  });

  it("selectVisibleIdeas：关 = 只有未归档", () => {
    const visible = selectVisibleIdeas({
      showArchivedIdeas: false,
      ideasInbox: [idea("a", "inbox")],
      ideasArchived: [idea("b", "archived")],
    });
    expect(visible.map((i) => i.name)).toEqual(["a"]);
  });

  it("selectVisibleIdeas：开 = 未归档在前、已归档附在后", () => {
    const visible = selectVisibleIdeas({
      showArchivedIdeas: true,
      ideasInbox: [idea("a", "inbox")],
      ideasArchived: [idea("b", "archived")],
    });
    expect(visible.map((i) => i.name)).toEqual(["a", "b"]);
  });
});
