/**
 * 真环境安装验收：从 CDN 装一次真的，再从装好的目录合成一句。
 *
 * **默认跳过**（要下 ~900MB）：`ENGINE_E2E=1 npx vitest run src/tests/engine/real-install.e2e.test.ts`
 *
 * 它验的是应用真正的安装路径 —— 清单坐标、续传下载器、sha256 校验、解包、
 * 版本化目录，最后**在安装目录里起进程出声**。最后这步同时证明产物是**可迁移**的
 * （rpath 与版本链接都指向包内，不指向构建机）。
 *
 * 计划里的 B7 真机验收可以先用它把"能装、能出声"这两条跑掉，剩下的（空闲回收、
 * 崩溃兜底、打断）仍需在应用里点一遍。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enginePaths,
  installEngine,
  isEngineInstalled,
} from "../../main/engine/engine-installer";
import { createEngineSupervisor } from "../../main/engine/engine-supervisor";
import { speakViaEngine } from "../../main/engine/engine-bridge";
import { readRuntimeSpec } from "../../main/speech/runtime-spec";

const enabled = process.env.ENGINE_E2E === "1";

describe.skipIf(!enabled)("真环境安装（CDN → 磁盘 → 出声）", () => {
  it(
    "装一次真的，再从装好的目录合成一句",
    async () => {
      const spec = readRuntimeSpec().ttsEngine;
      expect(spec, "清单里没有 ttsEngine").toBeTruthy();
      const userDataPath = mkdtempSync(join(tmpdir(), "engine-install-"));
      const paths = enginePaths(userDataPath, spec!);
      const phases: string[] = [];

      try {
        await installEngine({
          userDataPath,
          spec: spec!,
          platformKey: "darwin-arm64",
          onProgress: () => {},
          onPhase: (phase) => phases.push(phase),
          // 预热用真的：起进程 + 合成一句，与生产同一条路
          warmup: async () => {
            const supervisor = createEngineSupervisor({
              paths,
              log: () => {},
              logError: () => {},
            });
            const ready = await supervisor.ensureReady();
            expect(ready.ok).toBe(true);
            const result = await speakViaEngine(
              {
                text: "语音引擎自检，共 12 个字。", // i18n-allow-cjk 自检用语
                voiceId: "vivian",
                streamId: 0,
                send: () => {},
              },
              { supervisor },
            );
            supervisor.stop();
            expect(result.ok).toBe(true);
          },
        });

        expect(isEngineInstalled(userDataPath, spec!)).toBe(true);
        // 三个阶段都要走到（checking → downloading → installing）
        expect(new Set(phases)).toEqual(
          new Set(["checking", "downloading", "installing"]),
        );
      } finally {
        rmSync(userDataPath, { recursive: true, force: true });
      }
    },
    900_000,
  );
});
