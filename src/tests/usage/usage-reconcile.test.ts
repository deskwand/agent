import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createUsageSchema, queryUsage } from "../../main/usage/usage-store";
import { backfillUsageFromSessions } from "../../main/usage/usage-backfill";

/**
 * Credibility check: after a backfill, the chat totals must equal a direct scan
 * of the same JSONL — exact equality, not "close enough". This is the one
 * executable piece of evidence that the numbers can be trusted.
 */
describe("usage reconciliation", () => {
  it("backfilled chat totals equal a direct scan of the JSONL", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-reconcile-"));
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);

    const expected = { input: 0, output: 0, cacheRead: 0 };
    for (let s = 0; s < 3; s += 1) {
      const dir = path.join(root, `session-${s}`);
      fs.mkdirSync(dir, { recursive: true });
      const lines: string[] = [];
      for (let m = 0; m < 5; m += 1) {
        const input = s * 100 + m;
        const output = m * 3;
        const cacheRead = s * 7 + m * 11;
        expected.input += input;
        expected.output += output;
        expected.cacheRead += cacheRead;
        lines.push(
          JSON.stringify({
            type: "message",
            timestamp: "2026-09-12T00:00:00.000Z",
            message: {
              role: "assistant",
              provider: "deepseek",
              model: "deepseek-v4-flash",
              timestamp: 1_760_000_000_000 + s * 1000 + m,
              usage: { input, output, cacheRead, cacheWrite: 0 },
            },
          }),
        );
      }
      fs.writeFileSync(path.join(dir, "run.jsonl"), lines.join("\n"), "utf-8");
    }

    await backfillUsageFromSessions(db, root);
    const snap = queryUsage(db, "all", 1_800_000_000_000);

    expect(snap.totals.input).toBe(expected.input);
    expect(snap.totals.output).toBe(expected.output);
    expect(snap.totals.cacheRead).toBe(expected.cacheRead);
    expect(snap.totals.calls).toBe(15);

    // Idempotent: a second pass changes nothing.
    await backfillUsageFromSessions(db, root);
    const again = queryUsage(db, "all", 1_800_000_000_000);
    expect(again.totals).toEqual(snap.totals);

    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
