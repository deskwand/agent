import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("useIPC session rename contract", () => {
  it("invokes session.rename and returns it from the hook", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/renderer/hooks/useIPC.ts"),
      "utf8",
    );
    expect(source).toContain('type: "session.rename"');
    expect(source).toContain("renameSession,");
  });
});
