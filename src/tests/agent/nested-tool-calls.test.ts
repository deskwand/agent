import { describe, expect, it } from "vitest";
import { normalizeNestedToolCalls } from "../../shared/nested-tool-calls";

describe("normalizeNestedToolCalls", () => {
  it("preserves final status and missing arguments without parsing previews", () => {
    const snapshot = normalizeNestedToolCalls(
      "p",
      {
        complete: false,
        calls: [
          { id: "opaque", name: "write", argumentsBytes: 9000, status: "ok" },
        ],
      },
      undefined,
      "ok",
    );
    expect(snapshot.source).toBe("final");
    expect(snapshot.complete).toBe(false);
    expect(snapshot.calls[0]).toMatchObject({
      id: "opaque",
      name: "write",
      status: "ok",
      argumentsBytes: 9000,
    });
    expect(snapshot.calls[0].input).toBeUndefined();
  });

  it.each(["cancelled", "running"])(
    "maps terminal legacy %s to unfinished",
    (status) => {
      const snapshot = normalizeNestedToolCalls(
        "p",
        undefined,
        [
          { id: "p/?", name: "read", args: '{"path":"src/a.ts"}', status },
          { id: "p/?", name: "read", args: '{"path":"src/b.ts"}', status },
        ],
        "ok",
      );
      expect(snapshot.source).toBe("legacy");
      expect(snapshot.complete).toBe(false);
      expect(new Set(snapshot.calls.map((call) => call.id)).size).toBe(2);
      expect(snapshot.calls.every((call) => call.status === "unfinished")).toBe(
        true,
      );
      expect(snapshot.calls.every((call) => call.input === undefined)).toBe(
        true,
      );
      if (status === "cancelled") {
        expect(snapshot.calls.every((call) => call.cancelled === true)).toBe(
          true,
        );
      }
    },
  );

  it("distinguishes unavailable history from an explicitly empty record", () => {
    expect(
      normalizeNestedToolCalls("p", undefined, undefined, "ok").source,
    ).toBe("missing");
    expect(
      normalizeNestedToolCalls(
        "p",
        { calls: [], complete: true },
        undefined,
        "ok",
      ),
    ).toMatchObject({ source: "final", complete: true, calls: [] });
  });

  it("dedupes opaque real SDK call ids", () => {
    const snapshot = normalizeNestedToolCalls(
      "p",
      {
        complete: true,
        calls: [
          { id: "opaque", name: "read", status: "ok" },
          { id: "opaque", name: "read", status: "ok" },
          { id: "other", name: "search", status: "error", error: "boom" },
        ],
      },
      undefined,
      "ok",
    );
    expect(snapshot.calls.map((call) => call.id)).toEqual(["opaque", "other"]);
    expect(snapshot.source).toBe("final");
    // rows filtered/deduped → the record is no longer complete
    expect(snapshot.complete).toBe(false);
  });
});

it("treats empty or unusable legacy previews as unavailable, not confirmed empty", () => {
  for (const legacy of [[], [{}]]) {
    expect(
      normalizeNestedToolCalls("p", undefined, legacy, "ok"),
    ).toMatchObject({ source: "missing", complete: false, calls: [] });
  }
});
