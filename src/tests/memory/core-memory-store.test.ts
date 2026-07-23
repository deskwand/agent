import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CoreMemoryStore } from "../../main/memory/core-memory-store";

describe("CoreMemoryStore", () => {
  let tempRoot: string;
  let filePath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-core-memory-"));
    filePath = path.join(tempRoot, "core_memory.json");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("keeps in-memory state unchanged when durable writes fail", () => {
    const store = new CoreMemoryStore(filePath);
    store.applyActions([
      { op: "upsert", category: "preferences", key: "language", value: "中文" },
    ]);
    fs.rmSync(filePath);
    fs.mkdirSync(filePath);

    expect(() =>
      store.applyActions([
        {
          op: "upsert",
          category: "skills",
          key: "typescript",
          value: "熟悉 TypeScript",
        },
      ]),
    ).toThrow();
    expect(store.getRaw()).toEqual({ "preferences.language": "中文" });

    expect(() => store.clear()).toThrow();
    expect(store.getRaw()).toEqual({ "preferences.language": "中文" });
  });

  it("keeps newly applied memories when the store is at capacity", () => {
    const store = new CoreMemoryStore(filePath, 2);
    store.applyActions([
      { op: "upsert", category: "preferences", key: "language", value: "中文" },
      {
        op: "upsert",
        category: "skills",
        key: "typescript",
        value: "熟悉 TypeScript",
      },
    ]);

    store.applyActions([
      {
        op: "upsert",
        category: "interests",
        key: "memory",
        value: "关注 memory 系统",
      },
    ]);

    const keys = store.getEntries().map((entry) => entry.combinedKey);
    expect(keys).toContain("interests.memory");
    expect(keys).toHaveLength(2);
  });
});
