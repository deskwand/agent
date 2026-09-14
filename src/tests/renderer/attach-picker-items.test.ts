import { describe, expect, it } from "vitest";
import {
  filterPickerItems,
  mapVaultSnapshotItems,
  mapWorkspaceScan,
  pickerItemMimeType,
  type AttachPickerItem,
} from "../../renderer/components/attach/picker-items";

const items: AttachPickerItem[] = [
  { id: "report.pdf", label: "report.pdf", size: 1024 },
  { id: "src/Data/sales.csv", label: "src/Data/sales.csv", size: 2048 },
];

describe("mapVaultSnapshotItems", () => {
  it("uses the vault file name as id and label", () => {
    expect(
      mapVaultSnapshotItems([
        { name: "a.png", ext: ".png", size: 3, mtime: 1, syncStatus: "synced" },
      ]),
    ).toEqual([{ id: "a.png", label: "a.png", size: 3 }]);
  });
});

describe("mapWorkspaceScan", () => {
  it("uses the relative path as id and label", () => {
    expect(mapWorkspaceScan([{ relPath: "src/a.ts", size: 7 }])).toEqual([
      { id: "src/a.ts", label: "src/a.ts", size: 7 },
    ]);
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
