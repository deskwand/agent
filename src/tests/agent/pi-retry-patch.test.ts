import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentSession, SettingsManager } from "@earendil-works/pi-coding-agent";

const SDK = join(
  process.cwd(),
  "node_modules/@earendil-works/pi-coding-agent/dist/core",
);

function readSdk(relative: string): string {
  return readFileSync(join(SDK, relative), "utf8");
}

describe("pi SDK retry behavior", () => {
  it("caps the delay and ignores the retry budget when unbounded", async () => {
    const delays: number[] = [];
    const ctx = {
      settingsManager: {
        getRetrySettings: () => ({
          enabled: true,
          // 故意只给 2 次预算：unbounded 生效时它应该形同虚设
          maxRetries: 2,
          baseDelayMs: 1,
          agentLoopMaxDelayMs: 4,
          unbounded: true,
        }),
      },
      _retryAttempt: 0,
      _emit: (event: { type: string; delayMs?: number }) => {
        if (event.type === "auto_retry_start") delays.push(event.delayMs ?? -1);
      },
      agent: { state: { messages: [] } },
    };
    const _prepareRetry = (
      AgentSession.prototype as unknown as {
        _prepareRetry(
          this: typeof ctx,
          message: { errorMessage: string },
        ): Promise<boolean>;
      }
    )._prepareRetry;

    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(await _prepareRetry.call(ctx, { errorMessage: "reset" }));
    }

    // 2^0..2^2 递增，之后被 maxDelayMs 截住：证明封顶生效
    expect(delays).toEqual([1, 2, 4, 4, 4, 4]);
    // 第 3 次已经超过 maxRetries: 2，但仍返回 true：证明 unbounded 生效
    expect(results).toEqual([true, true, true, true, true, true]);
  });
});

describe("pi SDK retry patch is still applied", () => {
  it("keeps the patch sites in the installed SDK", () => {
    // 行为测试证明"现在是对的"，这一条让依赖升级时丢补丁的失败更容易定位。
    const session = readSdk("agent-session.js");
    expect(session).toContain(
      "Math.min(rawDelayMs, settings.agentLoopMaxDelayMs)",
    );
    expect(session).toContain(
      "!settings.unbounded && this._retryAttempt > settings.maxRetries",
    );
    expect(session).toContain(
      "!settings.unbounded && this._retryAttempt >= settings.maxRetries",
    );
    const settings = readSdk("settings-manager.js");
    expect(settings).toContain(
      "agentLoopMaxDelayMs: this.settings.retry?.agentLoopMaxDelayMs",
    );
    expect(settings).toContain(
      "unbounded: this.settings.retry?.unbounded ?? false",
    );
  });
});

describe("deskwand retry configuration", () => {
  it("survives SettingsManager.inMemory() so the cap reaches _prepareRetry", () => {
    // 关键回归：SDK 的 migrateSettings 会把 retry.maxDelayMs 搬到
    // retry.provider.maxRetryDelayMs 并 delete 掉原字段（inMemory 会调用它）。
    // 这个字段名一旦与迁移撞名，封顶就在生产环境静默失效。
    const settings = SettingsManager.inMemory({
      retry: {
        enabled: true,
        maxRetries: 2,
        baseDelayMs: 2000,
        agentLoopMaxDelayMs: 60000,
        unbounded: true,
      },
    });
    const resolved = settings.getRetrySettings();
    expect(resolved.agentLoopMaxDelayMs).toBe(60000);
    expect(resolved.unbounded).toBe(true);
    // 这两个字段保持原值，证明迁移没有把它们吃掉
    expect(resolved.maxRetries).toBe(2);
    expect(resolved.baseDelayMs).toBe(2000);
  });

  it("passes the cap + unbounded to both session factories", () => {
    const source = readFileSync(
      join(process.cwd(), "src/main/agent/agent-runner.ts"),
      "utf8",
    );
    // 弱断言：只证明意图已传递（行为封顶由上面的 describe 覆盖）
    expect(source.match(/agentLoopMaxDelayMs: 60000/g) ?? []).toHaveLength(2);
    expect(source.match(/unbounded: true/g) ?? []).toHaveLength(2);
  });
});
