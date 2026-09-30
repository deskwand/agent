/**
 * 预设 id 的 provider 身份回归守卫。
 *
 * 背景：0.85.1 → 0.87.1 时 deepseek-v4-flash 被 deepseek-flash 取代，旧 id 走到
 * 跨 provider 回退、命中 opencode 条目 —— 用户的 DeepSeek key 会被发到从未配置过的
 * 第三方主机。本测试把这个面钉住。
 *
 * 关键：断言的是「相对 0.87.1 基线**新增**了多少漂移/缺失」，不是「全对」的绝对不变式。
 * 下面 KNOWN_PREEXISTING 里的三条已实测确认在 0.87.1 的目录里**完全相同**，
 * 属既存缺陷、不在本次升级范围 —— 锚定基线才能既拦住本次引入的新问题，
 * 又不把无关的既存缺陷混进升级提交。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import {
  API_PROVIDER_PRESETS,
  PI_AI_CURATED_PRESETS,
} from "../../shared/api-model-presets";
import { resolvePiRegistryModel } from "../../main/agent/pi-model-resolution";

/** 预设 key ≠ pi provider 名的地方，以 PI_AI_CURATED_PRESETS 为准（gemini → google）。 */
function piProviderOf(key: string): string {
  const curated = (
    PI_AI_CURATED_PRESETS as Record<string, { piProvider?: string } | undefined>
  )[key];
  return curated?.piProvider ?? key;
}

/** 用户自填协议的预设，其 id 按设计不在 pi 目录里。 */
const NO_PI_CATALOG = new Set(["custom"]);

/**
 * 既存异常白名单。三条都已核对：0.87.1 与 0.99.1 的目录里完全相同。
 * 不要为了让测试变绿而删预设 —— 见文件头注释。
 */
const KNOWN_PREEXISTING = [
  "opencode-go/grok-4.5",
  "anthropic/claude-3-7-sonnet-latest",
  "zhipu/glm-4.6v-flash",
];

describe("preset model ids: no NEW cross-provider drift on 0.99.1", () => {
  const anomalies: string[] = [];

  for (const [key, preset] of Object.entries(API_PROVIDER_PRESETS)) {
    if (NO_PI_CATALOG.has(key)) continue;
    const expected = piProviderOf(key);
    for (const { id } of preset.models) {
      const model = resolvePiRegistryModel(`${expected}/${id}`);
      if (!model) {
        anomalies.push(`${key}/${id}（missing，期望 ${expected}）`);
      } else if (model.provider !== expected) {
        anomalies.push(
          `${key}/${id}（drift → ${model.provider}/${model.id}，期望 ${expected}）`,
        );
      }
    }
  }

  it("introduces no preset id that resolves to a different provider or vanishes", () => {
    writeFileSync(
      "/tmp/preset-audit.txt",
      anomalies.length ? anomalies.join("\n") : "(no anomalies)",
    );
    // 白名单按 `${key}/${id}` 加分隔符匹配 —— 只用 startsWith(known) 会让
    // 将来的 `opencode-go/grok-4.5-turbo` 被 `opencode-go/grok-4.5` 静默吸收。
    const unexpected = anomalies.filter(
      (entry) =>
        !KNOWN_PREEXISTING.some((known) => entry.startsWith(`${known}（`)),
    );
    // 把完整审计报告进断言消息，使测试本身自足（/tmp 文件只是给验证记录用的便利副本）。
    expect(
      { unexpected, fullAudit: anomalies },
      `完整审计：\n${anomalies.join("\n")}`,
    ).toEqual({ unexpected: [], fullAudit: anomalies });
  });

  it("KNOWN_PREEXISTING still describes reality (entry no longer anomalous?)", () => {
    // 如果这条失败，说明某个既存异常被修好了或被改名了 —— 好事，但要更新白名单，
    // 别让它继续挂在那里掩盖将来的同类问题。
    const stillAnomalous = KNOWN_PREEXISTING.filter((known) =>
      anomalies.some((entry) => entry.startsWith(`${known}（`)),
    );
    expect(stillAnomalous).toEqual(KNOWN_PREEXISTING);
  });
});
