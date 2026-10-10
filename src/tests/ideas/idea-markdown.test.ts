import { describe, expect, it } from "vitest";
import {
  buildIdeaFileName,
  parseIdeaFile,
  serializeIdeaFile,
  type IdeaRecord,
} from "../../main/ideas/idea-markdown";

const RECORD: IdeaRecord = {
  status: "inbox",
  createdAt: Date.parse("2026-10-11T15:04:07+08:00"),
  archivedAt: null,
  source: { session: "4f2a9c1e", view: "chat" },
  body: "浮层的 Enter 保存要判 isComposing。",
};

describe("序列化 → 解析往返", () => {
  it("原样回来", () => {
    expect(parseIdeaFile(serializeIdeaFile(RECORD), 0)).toEqual(RECORD);
  });

  it("正文里的 --- 与前后空行不被吃掉", () => {
    const record = { ...RECORD, body: "第一行\n\n---\n\n最后一行" };
    expect(parseIdeaFile(serializeIdeaFile(record), 0)).toEqual(record);
  });

  it("CRLF 文件照样解析", () => {
    const text = serializeIdeaFile(RECORD).replace(/\n/g, "\r\n");
    expect(parseIdeaFile(text, 0)).toEqual(RECORD);
  });

  it("归档时间往返", () => {
    const record = {
      ...RECORD,
      status: "archived" as const,
      archivedAt: 1759999999999,
    };
    expect(parseIdeaFile(serializeIdeaFile(record), 0)).toEqual(record);
  });
});

describe("容错：尽量救，不回写", () => {
  it("没有 frontmatter 的文件当成一条想法，时间取 mtime", () => {
    const record = parseIdeaFile("随手写的一句话\n没别的", 1758000000000);
    expect(record).toEqual({
      status: "inbox",
      createdAt: 1758000000000,
      archivedAt: null,
      source: { session: null, view: null },
      body: "随手写的一句话\n没别的",
    });
  });

  it("status 非法 → 归一成 inbox", () => {
    const text = "---\nstatus: done\n---\n\n正文";
    expect(parseIdeaFile(text, 7)?.status).toBe("inbox");
  });

  it("created 非法 → 取 mtime", () => {
    const text = "---\nstatus: inbox\ncreated: 不是日期\n---\n\n正文";
    expect(parseIdeaFile(text, 42)?.createdAt).toBe(42);
  });

  it("source 缺省 → 两个字段都是 null", () => {
    const text = "---\nstatus: inbox\n---\n\n正文";
    expect(parseIdeaFile(text, 7)?.source).toEqual({
      session: null,
      view: null,
    });
  });

  it("YAML 语法坏 → null（调用方计入 skipped）", () => {
    const text = "---\n[unclosed\n---\n\n正文";
    expect(parseIdeaFile(text, 7)).toBeNull();
  });
});

describe("文件名", () => {
  const at = Date.parse("2026-10-11T15:04:07+08:00");

  it("时间戳 + 首行截断", () => {
    expect(buildIdeaFileName("浮层捕获的三个细节\n第二行", at)).toBe(
      "2026-10-11-1504-浮层捕获的三个细节",
    );
  });

  it("非法字符被替换，空白折成一个 -", () => {
    expect(buildIdeaFileName('a/b:c*d?e"f<g>h|i  j', at)).toBe(
      "2026-10-11-1504-a-b-c-d-e-f-g-h-i-j",
    );
  });

  it("emoji 不被切坏", () => {
    const name = buildIdeaFileName("💡".repeat(30), at);
    expect(name).not.toContain("\uFFFD");
    expect([...name].length).toBeLessThanOrEqual(
      "2026-10-11-1504-".length + 24,
    );
  });

  it("正文只有空白 / 长文首行超长都不会产生空名", () => {
    expect(buildIdeaFileName("   \n\n  ", at)).toBe("2026-10-11-1504");
    expect(buildIdeaFileName("x".repeat(200), at)).toHaveLength(
      "2026-10-11-1504-".length + 24,
    );
  });
});
