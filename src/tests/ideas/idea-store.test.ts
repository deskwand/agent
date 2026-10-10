import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdeaStore } from "../../main/ideas/idea-store";

let root: string;
let store: IdeaStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ideas-"));
  store = new IdeaStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const create = (content: string) =>
  store.create({ content, sourceSessionId: "s1", sourceView: "chat" });

describe("create", () => {
  it("建目录、落盘、返回摘要", async () => {
    const summary = await create("浮层的 Enter 保存要判 isComposing");
    expect(summary.status).toBe("inbox");
    expect(summary.sourceSessionId).toBe("s1");
    const files = readdirSync(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-.+\.md$/);
  });

  it("不留 .tmp 残留（原子写）", async () => {
    await create("一条");
    expect(readdirSync(root).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("同一分钟同一句话不覆盖，追加 -2", async () => {
    const a = await create("重复的内容");
    const b = await create("重复的内容");
    expect(a.name).not.toBe(b.name);
    expect(b.name.endsWith("-2")).toBe(true);
  });

  it("正文超过 4000 码点 → IDEA_TOO_LONG", async () => {
    await expect(create("字".repeat(4001))).rejects.toThrow("IDEA_TOO_LONG");
  });
});

describe("list", () => {
  it("按状态分组，收件箱按 created 倒序", async () => {
    const first = await create("第一条");
    await new Promise((r) => setTimeout(r, 5));
    const second = await create("第二条");
    const list = await store.list();
    expect(list.inbox.map((i) => i.name)).toEqual([second.name, first.name]);
    expect(list.archived).toEqual([]);
  });

  it("没有 frontmatter 的文件也算一条（真的手工丢进去一个 md）", async () => {
    writeFileSync(join(root, "手写的.md"), "随手写的一句话", "utf8");
    const list = await store.list();
    expect(list.inbox).toHaveLength(1);
    expect(list.skipped).toBe(0);
  });

  it("YAML 坏的文件被跳过并计入 skipped", async () => {
    writeFileSync(join(root, "坏的.md"), "---\n[unclosed\n---\n\n正文", "utf8");
    const list = await store.list();
    expect(list.inbox).toEqual([]);
    expect(list.skipped).toBe(1);
  });

  it("非 .md 文件静默忽略、不计数", async () => {
    writeFileSync(join(root, "笔记.txt"), "x", "utf8");
    const list = await store.list();
    expect(list.inbox).toEqual([]);
    expect(list.skipped).toBe(0);
  });

  it("目录不存在 → 空列表而不是报错", async () => {
    rmSync(root, { recursive: true, force: true });
    await expect(store.list()).resolves.toEqual({
      inbox: [],
      archived: [],
      skipped: 0,
    });
  });

  it("目录读不了（不是不存在）→ 抛错，不要冒充空列表", async () => {
    // 把一个**文件**当根目录：readdir 会 ENOTDIR。报成"没有想法"会让用户重记一遍。
    const asFile = join(root, "不是一个目录");
    writeFileSync(asFile, "x", "utf8");
    await expect(new IdeaStore(asFile).list()).rejects.toThrow();
  });
});

describe("read / update（mtime 竞争）", () => {
  it("read 返回的是**正文**（frontmatter 已剥掉）与 mtime", async () => {
    const { name } = await create("正文一");
    const read = await store.read(name);
    expect(read.body).toBe("正文一");
    // 回归：曾经这里回的是整份文件，视图拿它当正文存回去 ⇒ 每存一次多嵌一层 frontmatter。
    expect(read.body).not.toContain("---");
    expect(read.body).not.toContain("status:");
    expect(read.mtimeMs).toBeGreaterThan(0);
  });

  it("read → body → update 往返之后，文件里只有一个 frontmatter 块", async () => {
    const { name } = await create("原始正文");
    const read = await store.read(name);
    await store.update(name, `${read.body}\n第二行`, read.mtimeMs);
    const onDisk = readFileSync(join(root, `${name}.md`), "utf8");
    expect(onDisk.match(/^---$/gm)).toHaveLength(2);
    expect(onDisk).toContain("原始正文\n第二行");
  });

  it("mtime 一致 → 写成功，并回一个能接着用的新 mtime", async () => {
    const { name } = await create("正文一");
    const { mtimeMs } = await store.read(name);
    const first = await store.update(name, "正文二", mtimeMs);
    expect((await store.read(name)).body).toContain("正文二");
    // 拿回的新 mtime 必须能直接用于第二次保存，否则编辑器改第二次就必然撞 IDEA_STALE。
    await expect(
      store.update(name, "正文三", first.mtimeMs),
    ).resolves.toBeDefined();
  });

  it("正文只有空白 → IDEA_EMPTY（agent 的 idea_add 能走到这里）", async () => {
    await expect(create("   \n  ")).rejects.toThrow("IDEA_EMPTY");
  });

  it("update 之后不留 .tmp 残留", async () => {
    const { name } = await create("正文一");
    const { mtimeMs } = await store.read(name);
    await store.update(name, "正文二", mtimeMs);
    expect(readdirSync(root).some((f) => f.includes(".tmp"))).toBe(false);
  });

  it("mtime 不一致 → IDEA_STALE，且不动文件", async () => {
    const { name } = await create("正文一");
    const { mtimeMs } = await store.read(name);
    writeFileSync(
      join(root, `${name}.md`),
      "---\nstatus: inbox\n---\n\n外部改的\n",
      "utf8",
    );
    await expect(store.update(name, "我要覆盖", mtimeMs)).rejects.toThrow(
      "IDEA_STALE",
    );
    expect((await store.read(name)).body).toContain("外部改的");
  });

  it("读不存在的名字 → IDEA_NOT_FOUND", async () => {
    await expect(store.read("不存在")).rejects.toThrow("IDEA_NOT_FOUND");
  });
});

describe("setStatus / remove", () => {
  it("归档写 archived 时间，恢复置回 null", async () => {
    const { name } = await create("一条");
    const archived = await store.setStatus(name, "archived");
    expect(archived.archivedAt).toBeGreaterThan(0);
    const restored = await store.setStatus(name, "inbox");
    expect(restored.archivedAt).toBeNull();
    expect((await store.list()).inbox).toHaveLength(1);
  });

  it("删除后文件消失，再删 → IDEA_NOT_FOUND", async () => {
    const { name } = await create("一条");
    await store.remove(name);
    expect(readdirSync(root)).toHaveLength(0);
    await expect(store.remove(name)).rejects.toThrow("IDEA_NOT_FOUND");
  });
});

describe("名字越界一律拒绝", () => {
  for (const bad of [
    "../逃逸",
    "/etc/passwd",
    "a/b",
    "..",
    "带\n换行",
    "尾点.",
    "con",
  ]) {
    it(`拒绝 ${JSON.stringify(bad)}`, async () => {
      await expect(store.read(bad)).rejects.toThrow("IDEA_BAD_NAME");
      await expect(store.remove(bad)).rejects.toThrow("IDEA_BAD_NAME");
    });
  }
});
