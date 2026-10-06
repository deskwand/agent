import { describe, expect, it } from "vitest";
import type { UsagePurpose } from "../../shared/usage";
import { buildAuxUsageRecord } from "../../main/usage/usage-records";

describe("feed 记账", () => {
  it("feed 是合法的 purpose，并能落进 aux 记录", () => {
    const purpose: UsagePurpose = "feed";
    const record = buildAuxUsageRecord(
      {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalPromptInput: 10,
      },
      purpose,
      "some-model",
      "some-provider",
      null,
      1_700_000_000_000,
    );
    expect(record.source).toBe("aux");
    expect(record.purpose).toBe("feed");
  });
});
