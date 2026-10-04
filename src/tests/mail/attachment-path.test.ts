import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  resolveAttachmentName,
  resolveAttachmentPath,
  sanitizeAttachmentName,
} from "../../main/mcp/mail/attachment-path";

describe("sanitizeAttachmentName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeAttachmentName("报告.pdf")).toBe("报告.pdf");
  });

  it("strips POSIX and Windows directory components", () => {
    expect(sanitizeAttachmentName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeAttachmentName("/etc/passwd")).toBe("passwd");
    expect(sanitizeAttachmentName("C:\\Windows\\win.ini")).toBe("win.ini");
    expect(sanitizeAttachmentName("a/b/c.txt")).toBe("c.txt");
  });

  it("refuses traversal-only and empty names", () => {
    expect(sanitizeAttachmentName("..")).toBe("unnamed");
    expect(sanitizeAttachmentName(".")).toBe("unnamed");
    expect(sanitizeAttachmentName("")).toBe("unnamed");
    expect(sanitizeAttachmentName("   ")).toBe("unnamed");
    expect(sanitizeAttachmentName(undefined)).toBe("unnamed");
    expect(sanitizeAttachmentName("../../")).toBe("unnamed");
  });

  it("drops control characters and NUL bytes", () => {
    expect(sanitizeAttachmentName("bad\u0000name.txt")).toBe("badname.txt");
    expect(sanitizeAttachmentName("line\nbreak.txt")).toBe("linebreak.txt");
  });

  it("replaces characters that are illegal in Windows filenames", () => {
    expect(sanitizeAttachmentName('a<b>c:d"e|f?g*h.txt')).toBe("abcdefgh.txt");
  });

  it("strips trailing dots and spaces that Windows silently drops", () => {
    expect(sanitizeAttachmentName("report.txt. ")).toBe("report.txt");
    // 全点号的名字也要落到 unnamed，而不是变成空串
    expect(sanitizeAttachmentName("...")).toBe("unnamed");
  });

  it("drops a leading dot so a file cannot be hidden", () => {
    expect(sanitizeAttachmentName(".bashrc")).toBe("bashrc");
  });

  it("caps the length of a name a hostile sender controls", () => {
    const long = `${"a".repeat(400)}.pdf`;
    const out = sanitizeAttachmentName(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("resolveAttachmentName", () => {
  it("keeps the first name untouched and suffixes later collisions", () => {
    const taken = new Set<string>();
    expect(resolveAttachmentName("报告.pdf", taken)).toBe("报告.pdf");
    expect(resolveAttachmentName("报告.pdf", taken)).toBe("报告 (2).pdf");
    expect(resolveAttachmentName("报告.pdf", taken)).toBe("报告 (3).pdf");
  });

  it("numbers before the extension, not after", () => {
    const taken = new Set(["a.tar.gz"]);
    expect(resolveAttachmentName("a.tar.gz", taken)).toBe("a.tar (2).gz");
  });

  it("scopes collisions per directory, not globally", () => {
    const taken = new Set<string>();
    resolveAttachmentName("x.txt", taken);
    // 名字不同 → 不参与去重
    expect(resolveAttachmentName("y.txt", taken)).toBe("y.txt");
  });
});

describe("resolveAttachmentPath", () => {
  const root = "/tmp/attachments";

  it("places files under root/email", () => {
    expect(
      resolveAttachmentPath({
        root,
        email: "zhangsan@qq.com",
        filename: "报告.pdf",
        taken: new Set<string>(),
      }),
    ).toBe(path.join(root, "zhangsan@qq.com", "报告.pdf"));
  });

  it("accepts a relative subdirectory", () => {
    expect(
      resolveAttachmentPath({
        root,
        email: "a@qq.com",
        filename: "x.txt",
        subdir: "2026-10",
        taken: new Set<string>(),
      }),
    ).toBe(path.join(root, "a@qq.com", "2026-10", "x.txt"));
  });

  it("rejects a subdirectory that escapes the root", () => {
    expect(() =>
      resolveAttachmentPath({
        root,
        email: "a@qq.com",
        filename: "x.txt",
        subdir: "../../etc",
        taken: new Set<string>(),
      }),
    ).toThrow(/subdir/i);
  });

  it("rejects an absolute subdirectory", () => {
    expect(() =>
      resolveAttachmentPath({
        root,
        email: "a@qq.com",
        filename: "x.txt",
        subdir: "/etc",
        taken: new Set<string>(),
      }),
    ).toThrow(/subdir/i);
  });

  it("never escapes the root even when the sender crafts the filename", () => {
    const out = resolveAttachmentPath({
      root,
      email: "a@qq.com",
      filename: "../../../../etc/passwd",
      taken: new Set<string>(),
    });
    expect(out.startsWith(path.join(root, "a@qq.com") + path.sep)).toBe(true);
    expect(out).toBe(path.join(root, "a@qq.com", "passwd"));
  });

  it("sanitizes a hostile email address used as a directory name", () => {
    const out = resolveAttachmentPath({
      root,
      email: "../evil@qq.com",
      filename: "x.txt",
      taken: new Set<string>(),
    });
    expect(out.startsWith(root + path.sep)).toBe(true);
  });
});

/**
 * 对抗性评审发现的回归。每一条都对应一个**真实复现过的**失败输入 ——
 * 不是假想的边界，所以不要再简化掉它们。
 */
describe("adversarial review regressions", () => {
  it("caps total length even when the extension is enormous", () => {
    // 曾复现：预算 = 120 - 5001 → 负数 → 只有词干被截，结果 5002 字符 → ENAMETOOLONG
    const out = sanitizeAttachmentName(`a.${"b".repeat(5000)}`);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(120);
  });

  it("caps length once a collision suffix is appended", () => {
    // 曾复现：120 字符的名字第一次碰撞就变成 124
    const taken = new Set<string>();
    const long = `${"a".repeat(118)}.pdf`;
    const first = resolveAttachmentName(long, taken);
    const second = resolveAttachmentName(long, taken);
    expect(Buffer.byteLength(first, "utf8")).toBeLessThanOrEqual(120);
    expect(Buffer.byteLength(second, "utf8")).toBeLessThanOrEqual(120);
    expect(second).not.toBe(first);
  });

  it("prefixes Windows device names that appear before the first dot", () => {
    // 曾复现：只查最后一个点号之前的词干，于是这些全部漏网
    expect(sanitizeAttachmentName("nul.tar.gz")).toBe("_nul.tar.gz");
    expect(sanitizeAttachmentName("com1.foo.bar")).toBe("_com1.foo.bar");
    expect(sanitizeAttachmentName("CON .txt")).toBe("_CON .txt");
  });

  it("still accepts a directory whose name merely starts with two dots", () => {
    // 曾复现：用 relative.startsWith("..") 判断，把合法的 `..foo` 误拒了
    expect(
      resolveAttachmentPath({
        root: "/tmp/a",
        email: "a@qq.com",
        filename: "x.txt",
        subdir: "..foo",
        taken: new Set<string>(),
      }),
    ).toBe(path.join("/tmp/a", "a@qq.com", "..foo", "x.txt"));
  });

  it("rejects a subdir containing a .. segment instead of silently rewriting it", () => {
    // 顺序错了会让 `..` 在净化阶段被吃掉，静默落到别的目录
    expect(() =>
      resolveAttachmentPath({
        root: "/tmp/a",
        email: "a@qq.com",
        filename: "x.txt",
        subdir: "a/../../b",
        taken: new Set<string>(),
      }),
    ).toThrow(/subdir/i);
  });

  it("does not split a surrogate pair or blow the byte budget on emoji", () => {
    // 按字符截断会让 116 个 emoji（464 字节）通过长度检查然后 ENAMETOOLONG
    const out = sanitizeAttachmentName(`${"😀".repeat(200)}.pdf`);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(120);
    expect(out).not.toContain("\uFFFD");
  });

  it("keeps a CJK name within the byte budget", () => {
    const out = sanitizeAttachmentName(`${"报".repeat(200)}.pdf`);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("caps how deep a subdir may go", () => {
    const out = resolveAttachmentPath({
      root: "/tmp/a",
      email: "a@qq.com",
      filename: "x.txt",
      subdir: "a/b/c/d/e/f/g",
      taken: new Set<string>(),
    });
    const rel = path.relative(path.join("/tmp/a", "a@qq.com"), out);
    // 最多 4 层目录 + 文件名
    expect(rel.split(path.sep).length).toBeLessThanOrEqual(5);
  });
});

describe("subdir trailing-dot tricks", () => {
  it("treats `.. ` as traversal, not as a literal directory name", () => {
    // Windows 会把尾部的点与空格丢掉，所以 `.. ` 落到盘上就是 `..`
    expect(() =>
      resolveAttachmentPath({
        root: "/tmp/a",
        email: "a@qq.com",
        filename: "x.txt",
        subdir: ".. ",
        taken: new Set<string>(),
      }),
    ).toThrow(/subdir/i);
  });

  it("drops a segment that only becomes `..` after sanitizing", () => {
    const out = resolveAttachmentPath({
      root: "/tmp/a",
      email: "a@qq.com",
      filename: "x.txt",
      subdir: "..<",
      taken: new Set<string>(),
    });
    expect(out.startsWith("/tmp/a" + path.sep)).toBe(true);
  });
});
