import { describe, expect, it } from "vitest";
import {
  canSplit,
  countLeaves,
  createLeaf,
  deserializeTree,
  findNeighborPane,
  findPaneBySession,
  layoutDividers,
  layoutRects,
  nearestLeafAfterRemoval,
  removeLeaf,
  serializeTree,
  setRatioAt,
  splitLeaf,
  visiblePaneSessionIds,
  type SplitNode,
} from "../../renderer/store/split-tree";

const leaf = (paneId: string, sessionId: string | null = null): SplitNode =>
  createLeaf(sessionId, paneId);
const split = (
  dir: "row" | "column",
  a: SplitNode,
  b: SplitNode,
  ratio = 0.5,
): SplitNode => ({ kind: "split", dir, ratio, a, b });

describe("split-tree", () => {
  it("splitLeaf 向右分割", () => {
    const A = leaf("A");
    const B = leaf("B");
    expect(splitLeaf(A, "A", "row", "after", B)).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: A,
      b: B,
    });
  });

  it("splitLeaf before 把新叶子放到 a", () => {
    const A = leaf("A");
    const B = leaf("B");
    const r = splitLeaf(A, "A", "column", "before", B);
    expect(r).toEqual(split("column", B, A));
  });

  it("removeLeaf 兄弟上移", () => {
    const A = leaf("A");
    const B = leaf("B");
    const C = leaf("C");
    expect(removeLeaf(split("row", A, split("column", B, C)), "B")).toEqual(
      split("row", A, C),
    );
    expect(removeLeaf(A, "A")).toBe(A);
  });

  it("findPaneBySession 命中 / 未命中返回 null", () => {
    const t = split("row", leaf("A", "S1"), leaf("B", "S2"));
    expect(findPaneBySession(t, "S2")).toBe("B");
    expect(findPaneBySession(t, "S9")).toBeNull();
  });

  it("canSplit 到上限", () => {
    const t = split(
      "row",
      split("column", leaf("A"), leaf("C")),
      split("column", leaf("B"), leaf("D")),
    );
    expect(countLeaves(t)).toBe(4);
    expect(
      canSplit(t, { x: 0, y: 0, width: 2000, height: 2000 }, "row"),
    ).toEqual({ ok: false, reason: "limit" });
  });

  it("canSplit 空间不足", () => {
    const t = leaf("A");
    const r = (width: number, height: number) => ({
      x: 0,
      y: 0,
      width,
      height,
    });
    expect(canSplit(t, r(700, 1000), "row")).toEqual({
      ok: false,
      reason: "space",
    });
    expect(canSplit(t, r(720, 1000), "row")).toEqual({ ok: true });
    expect(canSplit(t, r(1000, 470), "column")).toEqual({
      ok: false,
      reason: "space",
    });
    expect(canSplit(t, r(1000, 480), "column")).toEqual({ ok: true });
  });

  it("setRatioAt 钳制", () => {
    const t = split("row", leaf("A"), leaf("B"));
    expect(setRatioAt(t, [], 0)).toMatchObject({ ratio: 0.15 });
    expect(setRatioAt(t, [], 1)).toMatchObject({ ratio: 0.85 });
  });

  it("layoutRects", () => {
    const t = split("row", leaf("A"), leaf("B"));
    const m = layoutRects(t, { x: 0, y: 0, width: 1000, height: 800 });
    expect(m.get("A")).toEqual({ x: 0, y: 0, width: 500, height: 800 });
    expect(m.get("B")).toEqual({ x: 500, y: 0, width: 500, height: 800 });
  });

  it("findNeighborPane", () => {
    const t = split(
      "row",
      split("column", leaf("A"), leaf("C")),
      split("column", leaf("B"), leaf("D")),
    );
    const bounds = { x: 0, y: 0, width: 1000, height: 800 };
    expect(findNeighborPane(t, bounds, "A", "right")).toBe("B");
    expect(findNeighborPane(t, bounds, "A", "down")).toBe("C");
    expect(findNeighborPane(t, bounds, "A", "left")).toBeNull();
  });

  it("nearestLeafAfterRemoval", () => {
    const t = split("row", leaf("A"), split("column", leaf("B"), leaf("C")));
    expect(nearestLeafAfterRemoval(t, "A")).toBe("B");
  });

  it("deserializeTree 往返", () => {
    const t = split(
      "row",
      leaf("A", "S1"),
      split("column", leaf("B"), leaf("C")),
      0.3,
    );
    expect(deserializeTree(serializeTree(t))).toEqual(t);
  });

  it("deserializeTree 损坏数据", () => {
    expect(deserializeTree("not json")).toBeNull();
    expect(deserializeTree("{}")).toBeNull();
    const five = split(
      "row",
      split("row", leaf("A"), leaf("B")),
      split("row", leaf("C"), split("row", leaf("D"), leaf("E"))),
    );
    expect(deserializeTree(JSON.stringify(five))).toBeNull();
  });

  it("deserializeTree 钳制比例", () => {
    const mk = (ratio: number | null) =>
      JSON.stringify({ ...split("row", leaf("A"), leaf("B")), ratio });
    // JSON 中 NaN 序列化为 null
    expect(deserializeTree(mk(null))).toMatchObject({ ratio: 0.5 });
    expect(deserializeTree(mk(0))).toMatchObject({ ratio: 0.15 });
  });
});

describe("visiblePaneSessionIds", () => {
  const tree = split("row", leaf("A", "S1"), leaf("B", null));

  it("分屏区挂载时返回各区域会话", () => {
    expect([...visiblePaneSessionIds(tree, true)]).toEqual(["S1"]);
  });

  it("分屏区未挂载时为空集合", () => {
    expect(visiblePaneSessionIds(tree, false).size).toBe(0);
  });
});

describe("layoutDividers", () => {
  it("叶子没有分隔线", () => {
    expect(
      layoutDividers(leaf("A"), { x: 0, y: 0, width: 100, height: 100 }),
    ).toEqual([]);
  });

  it("row 分割在 a/b 交界处给出竖线", () => {
    const tree = split("row", leaf("A"), leaf("B"), 0.4);
    expect(
      layoutDividers(tree, { x: 10, y: 20, width: 1000, height: 500 }),
    ).toEqual([
      {
        path: [],
        dir: "row",
        rect: { x: 410, y: 20, width: 0, height: 500 },
        size: 1000,
      },
    ]);
  });

  it("嵌套分割按各自节点的范围与长度计算", () => {
    const tree = split(
      "row",
      split("column", leaf("A"), leaf("B"), 0.25),
      leaf("C"),
    );
    const dividers = layoutDividers(tree, {
      x: 0,
      y: 0,
      width: 1000,
      height: 400,
    });
    expect(dividers).toHaveLength(2);
    expect(dividers[1]).toEqual({
      path: ["a"],
      dir: "column",
      rect: { x: 0, y: 100, width: 500, height: 0 },
      size: 400,
    });
  });
});
