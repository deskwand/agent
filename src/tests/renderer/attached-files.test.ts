import { describe, expect, it } from "vitest";
import {
  attachmentKey,
  attachmentKeySet,
  mergeAttachedFiles,
} from "../../renderer/utils/attached-files";
import type { ChatInputAttachedFile } from "../../renderer/components/ChatInput";

function file(
  overrides: Partial<ChatInputAttachedFile>,
): ChatInputAttachedFile {
  return {
    name: "a.txt",
    path: "/tmp/a.txt",
    size: 1,
    type: "application/octet-stream",
    ...overrides,
  };
}

describe("attachmentKey", () => {
  it("uses the explicit dedupe id when the picker provided one", () => {
    expect(
      attachmentKey(
        file({ source: "vault", name: "a.txt", dedupeId: "a.txt" }),
      ),
    ).toBe("vault:a.txt");
  });

  it("falls back to the path for dialog and drag attachments", () => {
    expect(attachmentKey(file({ path: "/x/report.pdf" }))).toBe(
      "local:/x/report.pdf",
    );
  });

  it("keeps two same-named files from different folders apart", () => {
    expect(attachmentKey(file({ path: "/a/report.pdf" }))).not.toBe(
      attachmentKey(file({ path: "/b/report.pdf" })),
    );
  });
});

describe("mergeAttachedFiles", () => {
  it("returns the previous array when everything is already attached", () => {
    const prev = [file({ path: "/a.txt" })];
    expect(mergeAttachedFiles(prev, [file({ path: "/a.txt" })])).toBe(prev);
  });

  it("appends only the new files, keeping order", () => {
    const prev = [file({ path: "/a.txt" })];
    const next = [
      file({ path: "/a.txt" }),
      file({ path: "/b.txt" }),
      file({ path: "/c.txt" }),
    ];
    expect(mergeAttachedFiles(prev, next).map((f) => f.path)).toEqual([
      "/a.txt",
      "/b.txt",
      "/c.txt",
    ]);
  });

  it("lets the same name from different sources coexist", () => {
    const prev = [
      file({
        source: "vault",
        name: "r.pdf",
        path: "/v/r.pdf",
        dedupeId: "r.pdf",
      }),
    ];
    const merged = mergeAttachedFiles(prev, [
      file({
        source: "workspace",
        name: "r.pdf",
        path: "/repo/r.pdf",
        dedupeId: "r.pdf",
      }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("attachmentKeySet", () => {
  it("returns the previous set when the keys are unchanged", () => {
    const prev = new Set(["vault:a"]);
    expect(
      attachmentKeySet(
        [file({ source: "vault", name: "a", dedupeId: "a" })],
        prev,
      ),
    ).toBe(prev);
  });

  it("returns a new set when a key is added or removed", () => {
    const prev = new Set(["vault:a"]);
    const added = attachmentKeySet(
      [
        file({ source: "vault", name: "a", dedupeId: "a" }),
        file({ source: "vault", name: "b", dedupeId: "b" }),
      ],
      prev,
    );
    expect(added).not.toBe(prev);
    expect([...added].sort()).toEqual(["vault:a", "vault:b"]);

    const removed = attachmentKeySet([], prev);
    expect(removed).not.toBe(prev);
    expect([...removed]).toEqual([]);
  });
});
