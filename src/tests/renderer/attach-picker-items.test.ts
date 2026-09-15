import { describe, expect, it } from "vitest";
import {
  filterPickerItems,
  mapVaultSnapshotItems,
  mapWorkspaceScan,
  pickerItemMimeType,
  splitRelPath,
  type AttachPickerItem,
} from "../../renderer/components/attach/picker-items";

const items: AttachPickerItem[] = [
  { id: "report.pdf", name: "report.pdf", label: "report.pdf", size: 1024 },
  {
    id: "src/Data/sales.csv",
    name: "sales.csv",
    dir: "src/Data",
    label: "src/Data/sales.csv",
    size: 2048,
  },
];

describe("mapVaultSnapshotItems", () => {
  it("uses the vault file name as id, name and label, with no dir", () => {
    expect(
      mapVaultSnapshotItems([
        { name: "a.png", ext: ".png", size: 3, mtime: 1, syncStatus: "synced" },
      ]),
    ).toEqual([
      { id: "a.png", name: "a.png", dir: undefined, size: 3, label: "a.png" },
    ]);
  });
});

describe("mapWorkspaceScan", () => {
  it("splits the relative path into dir and file name", () => {
    expect(
      mapWorkspaceScan([{ relPath: "src/data/report.csv", size: 7 }]),
    ).toEqual([
      {
        id: "src/data/report.csv",
        name: "report.csv",
        dir: "src/data",
        size: 7,
        label: "src/data/report.csv",
      },
    ]);
  });

  it("leaves dir undefined for a top-level file", () => {
    expect(mapWorkspaceScan([{ relPath: "README.md", size: 9 }])[0]).toEqual({
      id: "README.md",
      name: "README.md",
      dir: undefined,
      size: 9,
      label: "README.md",
    });
  });
});

describe("splitRelPath", () => {
  it("splits on the last slash", () => {
    expect(splitRelPath("a/b/c.txt")).toEqual({ dir: "a/b", name: "c.txt" });
  });

  it("returns no dir for a bare name", () => {
    expect(splitRelPath("c.txt")).toEqual({ dir: undefined, name: "c.txt" });
  });

  it("handles backslashes and trailing separators", () => {
    expect(splitRelPath("a\\b\\c.txt")).toEqual({ dir: "a/b", name: "c.txt" });
    expect(splitRelPath("a/b/")).toEqual({ dir: "a", name: "b" });
  });
});

describe("filterPickerItems", () => {
  it("returns everything for an empty query", () => {
    expect(filterPickerItems(items, "")).toEqual(items);
    expect(filterPickerItems(items, "   ")).toEqual(items);
  });

  it("matches case-insensitively as a substring", () => {
    expect(filterPickerItems(items, "data").map((i) => i.id)).toEqual([
      "src/Data/sales.csv",
    ]);
    expect(filterPickerItems(items, "REPORT").map((i) => i.id)).toEqual([
      "report.pdf",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterPickerItems(items, "zzz")).toEqual([]);
  });
});

describe("pickerItemMimeType", () => {
  it("maps the four vision-supported image extensions", () => {
    expect(pickerItemMimeType("a.png")).toBe("image/png");
    expect(pickerItemMimeType("a.jpg")).toBe("image/jpeg");
    expect(pickerItemMimeType("a.jpeg")).toBe("image/jpeg");
    expect(pickerItemMimeType("a.gif")).toBe("image/gif");
    expect(pickerItemMimeType("a.webp")).toBe("image/webp");
  });

  it("does not claim an image mime for types the vision path rejects", () => {
    expect(pickerItemMimeType("a.svg")).toBe("application/octet-stream");
    expect(pickerItemMimeType("a.bmp")).toBe("application/octet-stream");
  });

  it("falls back to a generic binary type", () => {
    expect(pickerItemMimeType("archive.tar.gz")).toBe(
      "application/octet-stream",
    );
    expect(pickerItemMimeType("Makefile")).toBe("application/octet-stream");
  });
});
