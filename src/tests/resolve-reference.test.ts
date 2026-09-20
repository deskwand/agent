import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveFileReference } from "../main/files/resolve-reference";

describe("resolveFileReference", () => {
  let workspace: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-ref-"));
    fs.mkdirSync(path.join(workspace, "test_docs"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "test_docs", "report.docx"), "x");
    fs.writeFileSync(path.join(workspace, "top.md"), "y");
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const roots = () => [workspace];

  it("returns the direct path when it exists", () => {
    const res = resolveFileReference("top.md", workspace, roots());
    expect(res.via).toBe("direct");
    expect(res.path).toBe(path.join(workspace, "top.md"));
  });

  it("falls back to a search by filename when the joined path is missing", () => {
    // 这正是事故现场：消息里只给了裸名 report.docx，文件却在下级目录
    const res = resolveFileReference("report.docx", workspace, roots());
    expect(res.via).toBe("by-name");
    expect(res.path).toBe(path.join(workspace, "test_docs", "report.docx"));
  });

  it("honours a relative path that already carries the directory", () => {
    const res = resolveFileReference(
      "test_docs/report.docx",
      workspace,
      roots(),
    );
    expect(res.via).toBe("direct");
    expect(res.path).toBe(path.join(workspace, "test_docs", "report.docx"));
  });

  it("returns the joined path unchanged when nothing matches", () => {
    const res = resolveFileReference("ghost.docx", workspace, roots());
    expect(res.via).toBe("unresolved");
    // 关键：返回原路径，保持改动前的失败行为
    expect(res.path).toBe(path.join(workspace, "ghost.docx"));
  });

  it("treats an absolute existing path as direct", () => {
    const abs = path.join(workspace, "top.md");
    const res = resolveFileReference(abs, workspace, roots());
    expect(res.via).toBe("direct");
    expect(res.path).toBe(abs);
  });

  it("works with a null workingDir when the token is absolute", () => {
    const abs = path.join(workspace, "top.md");
    expect(resolveFileReference(abs, null, []).path).toBe(abs);
  });

  it("returns an empty path for an empty token", () => {
    const res = resolveFileReference("", workspace, roots());
    expect(res.path).toBe("");
    expect(res.via).toBe("unresolved");
  });
});
