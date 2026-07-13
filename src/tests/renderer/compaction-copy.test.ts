import { describe, expect, it } from "vitest";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";

describe("compaction status copy", () => {
  it("describes context compaction consistently in both locales", () => {
    expect(zh.chat.compacting).toBe("正在压缩上下文...");
    expect(zh.chat.compacted).toBe("上下文压缩完成");
    expect(zh.chat.compactFailed).toBe("上下文压缩失败");
    expect(zh.chat.compactAborted).toBe("上下文压缩已取消");
    expect(zh.chat.alreadyCompacted).toBe("上下文已压缩");

    expect(en.chat.compacting).toBe("Compacting context...");
    expect(en.chat.compacted).toBe("Context compaction complete");
    expect(en.chat.compactFailed).toBe("Context compaction failed");
    expect(en.chat.compactAborted).toBe("Context compaction cancelled");
    expect(en.chat.alreadyCompacted).toBe("Context already compacted");
  });
});
