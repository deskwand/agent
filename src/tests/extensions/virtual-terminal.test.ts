import { describe, it, expect, vi } from "vitest";
import { VirtualTerminal } from "../../main/extensions/ui/virtual-terminal";

describe("VirtualTerminal", () => {
  it("batches write() calls into a single frame (full screen text)", async () => {
    const onFrame = vi.fn();
    const vt = new VirtualTerminal({
      onFrame,
      onResizeRequest: () => {},
      onTitleChange: () => {},
    });
    vt.write("line1\n");
    vt.write("line2\n");
    vt.flushNow();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith("line1\nline2");
  });

  it("forwards input via injectInput to start() handler", () => {
    const onFrame = vi.fn();
    const vt = new VirtualTerminal({
      onFrame,
      onResizeRequest: () => {},
      onTitleChange: () => {},
    });
    const handler = vi.fn();
    vt.start(handler, () => {});
    vt.injectInput("\x1b[A");
    expect(handler).toHaveBeenCalledWith("\x1b[A");
  });

  it("reports size set via setSize", () => {
    const onFrame = vi.fn();
    const vt = new VirtualTerminal({
      onFrame,
      onResizeRequest: () => {},
      onTitleChange: () => {},
    });
    vt.setSize(100, 30);
    expect(vt.columns).toBe(100);
    expect(vt.rows).toBe(30);
  });

  it("defaults to 80x24", () => {
    const onFrame = vi.fn();
    const vt = new VirtualTerminal({
      onFrame,
      onResizeRequest: () => {},
      onTitleChange: () => {},
    });
    expect(vt.columns).toBe(80);
    expect(vt.rows).toBe(24);
  });
});
