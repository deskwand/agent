import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "../../main/db/database.ts");
function readSrc(): string {
  return fs.readFileSync(SRC, "utf-8");
}

describe("messages table removal (spec §9 step 3)", () => {
  it("database.ts exposes no messages table or namespace", () => {
    const src = readSrc();
    expect(src).not.toContain("CREATE TABLE IF NOT EXISTS messages");
    expect(src).not.toContain("MessageRow");
    expect(src).not.toContain("queryMessagesPage");
    expect(src).not.toContain("messages: {");
  });
});
