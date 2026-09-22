// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DRAFT_IMAGE_CHARS,
  NEW_SESSION_DRAFT_KEY,
  capDraftImages,
  draftStorageKey,
  isDraftEmpty,
  pruneDrafts,
  readDraft,
  removeDraft,
  writeDraft,
  type ChatDraft,
} from "../../renderer/utils/chat-draft-store";

function makeDraft(overrides: Partial<ChatDraft> = {}): ChatDraft {
  return {
    v: 1,
    text: "半句话",
    images: [],
    files: [],
    elSelections: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat-draft-store", () => {
  it("round-trip：写进去读出来一致", () => {
    const draft = makeDraft({
      images: [{ base64: "AAAA", mediaType: "image/jpeg" }],
    });
    expect(writeDraft("s1", draft)).toBe(true);
    expect(readDraft("s1")).toEqual(draft);
  });

  it("缺失的槽位读回 null", () => {
    expect(readDraft("nope")).toBeNull();
  });

  it("损坏的 JSON：读回 null 并清掉脏 key", () => {
    localStorage.setItem(draftStorageKey("s1"), "{ not json");
    expect(readDraft("s1")).toBeNull();
    expect(localStorage.getItem(draftStorageKey("s1"))).toBeNull();
  });

  it("版本不符：读回 null 并清掉脏 key", () => {
    localStorage.setItem(
      draftStorageKey("s1"),
      JSON.stringify({ ...makeDraft(), v: 99 }),
    );
    expect(readDraft("s1")).toBeNull();
    expect(localStorage.getItem(draftStorageKey("s1"))).toBeNull();
  });

  it("空草稿 = 删除 key（防「旧草稿复活」）", () => {
    writeDraft("s1", makeDraft());
    expect(localStorage.getItem(draftStorageKey("s1"))).not.toBeNull();
    writeDraft("s1", makeDraft({ text: "" }));
    expect(localStorage.getItem(draftStorageKey("s1"))).toBeNull();
  });

  it("只有 /skill: 令牌、没有正文也算空", () => {
    expect(isDraftEmpty(makeDraft({ text: "/skill:pdf " }))).toBe(true);
  });

  it("图片合计超预算：从末尾截断，保留先贴的", () => {
    const kept = capDraftImages(
      [
        { base64: "a".repeat(60), mediaType: "image/jpeg" },
        { base64: "b".repeat(60), mediaType: "image/jpeg" },
        { base64: "c".repeat(60), mediaType: "image/jpeg" },
      ],
      100,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].base64).toBe("a".repeat(60));
  });

  it("默认预算常量是 10M 字符", () => {
    expect(MAX_DRAFT_IMAGE_CHARS).toBe(10_000_000);
  });

  it("配额不足：先丢图片重试，文本保住", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    const draft = makeDraft({
      images: [{ base64: "AAAA", mediaType: "image/jpeg" }],
    });
    expect(writeDraft("s1", draft)).toBe(true);
    expect(readDraft("s1")?.text).toBe("半句话");
    expect(readDraft("s1")?.images).toEqual([]);
  });

  it("pruneDrafts 只留给定会话 + __new__ 槽位", () => {
    writeDraft("keep", makeDraft({ text: "a" }));
    writeDraft("drop", makeDraft({ text: "b" }));
    writeDraft(NEW_SESSION_DRAFT_KEY, makeDraft({ text: "c" }));

    pruneDrafts(["keep"]);

    expect(readDraft("keep")).not.toBeNull();
    expect(readDraft("drop")).toBeNull();
    expect(readDraft(NEW_SESSION_DRAFT_KEY)).not.toBeNull();
  });

  it("removeDraft 删掉槽位", () => {
    writeDraft("s1", makeDraft());
    removeDraft("s1");
    expect(readDraft("s1")).toBeNull();
  });

  it("同版本但数组里有非对象元素：当空草稿丢弃，不把异常带到渲染路径", () => {
    for (const bad of [
      { images: [null] },
      { files: [null] },
      { elSelections: [null] },
    ]) {
      localStorage.setItem(
        draftStorageKey("s1"),
        JSON.stringify({ ...makeDraft(), ...bad }),
      );
      expect(readDraft("s1")).toBeNull();
      expect(localStorage.getItem(draftStorageKey("s1"))).toBeNull();
    }
  });

  it("localStorage 不可用时静默 no-op（node 环境的 store 测试会走到这条）", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => removeDraft("s1")).not.toThrow();
    expect(() => pruneDrafts(["s1"])).not.toThrow();
    expect(readDraft("s1")).toBeNull();
    expect(writeDraft("s1", makeDraft())).toBe(false);
  });
});
