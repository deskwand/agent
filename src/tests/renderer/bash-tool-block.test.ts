import { describe, expect, it } from "vitest";
import { canHandleBashInput } from "../../renderer/components/message/BashToolBlock";

describe("canHandleBashInput", () => {
  it("accepts valid input with command string", () => {
    expect(canHandleBashInput({ command: "npm run build" })).toBe(true);
  });

  it("accepts valid input with cmd alias", () => {
    expect(canHandleBashInput({ cmd: "npm test" })).toBe(true);
  });

  it("rejects undefined input", () => {
    expect(canHandleBashInput(undefined)).toBe(false);
  });

  it("rejects input with no command field", () => {
    expect(canHandleBashInput({ timeout: 30000 })).toBe(false);
  });

  it("rejects input with empty command", () => {
    expect(canHandleBashInput({ command: "" })).toBe(false);
  });

  it("rejects input with whitespace-only command", () => {
    expect(canHandleBashInput({ command: "   " })).toBe(false);
  });

  it("rejects input with non-string command (number)", () => {
    expect(canHandleBashInput({ command: 123 })).toBe(false);
  });

  it("rejects input with non-string command (null)", () => {
    expect(canHandleBashInput({ command: null })).toBe(false);
  });
});
