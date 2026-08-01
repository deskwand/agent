import { describe, it, expect } from "vitest";
import { normalizeKeyEvent } from "../../renderer/utils/key-normalizer";

describe("normalizeKeyEvent", () => {
  it("maps arrows to escape sequences", () => {
    expect(
      normalizeKeyEvent({ key: "ArrowUp", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\x1b[A");
    expect(
      normalizeKeyEvent({ key: "ArrowDown", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\x1b[B");
    expect(
      normalizeKeyEvent({ key: "ArrowLeft", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\x1b[D");
    expect(
      normalizeKeyEvent({ key: "ArrowRight", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\x1b[C");
  });

  it("maps ctrl+arrow with modifier 5", () => {
    expect(
      normalizeKeyEvent({ key: "ArrowUp", ctrlKey: true, altKey: false, shiftKey: false }),
    ).toBe("\x1b[1;5A");
  });

  it("maps enter, escape, tab, backspace", () => {
    expect(
      normalizeKeyEvent({ key: "Enter", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\r");
    expect(
      normalizeKeyEvent({ key: "Escape", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\x1b");
    expect(
      normalizeKeyEvent({ key: "Tab", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\t");
    expect(
      normalizeKeyEvent({ key: "Tab", ctrlKey: false, altKey: false, shiftKey: true }),
    ).toBe("\x1b[Z");
    expect(
      normalizeKeyEvent({ key: "Backspace", ctrlKey: false, altKey: false, shiftKey: false }),
    ).toBe("\x7f");
  });

  it("maps ctrl+letter to control codes", () => {
    expect(
      normalizeKeyEvent({ key: "a", ctrlKey: true, altKey: false, shiftKey: false }),
    ).toBe("\x01");
    expect(
      normalizeKeyEvent({ key: "c", ctrlKey: true, altKey: false, shiftKey: false }),
    ).toBe("\x03");
  });

  it("maps alt+char to ESC prefix", () => {
    expect(
      normalizeKeyEvent({ key: "x", ctrlKey: false, altKey: true, shiftKey: false }),
    ).toBe("\x1bx");
  });

  it("returns null for modifier-only keys", () => {
    expect(
      normalizeKeyEvent({ key: "Control", ctrlKey: true, altKey: false, shiftKey: false }),
    ).toBeNull();
    expect(
      normalizeKeyEvent({ key: "Shift", ctrlKey: false, altKey: false, shiftKey: true }),
    ).toBeNull();
  });
});
