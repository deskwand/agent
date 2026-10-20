/**
 * 手工验真：真实打包产物解出来的形状，必须被安装器的路径契约认下来。
 *
 * 默认跳过（需要先把包解到某个目录）：
 *
 *   EMOTION_CONTRACT_DIR=/tmp/emotion-spike/contract npx vitest run \
 *     src/tests/voice/emotion-install-contract.manual.test.ts
 *
 * 为什么需要它：strip 0 与「顶层就是内容」这条约定一旦破（例如打包脚本多套一层目录），
 * 结果是「装完了还判未装」—— 单测用假目录拦不住这个，只有真产物能。
 */
import { describe, expect, it } from "vitest";
import {
  EMOTION_MODEL_ID,
  EMOTION_RUNTIME_VERSION,
  isEmotionInstalled,
  modelDir,
  runtimeDir,
} from "../../main/voice/emotion/installer";

const DIR = process.env.EMOTION_CONTRACT_DIR;

describe.skipIf(!DIR)("情感安装路径契约（真产物）", () => {
  it("解出来的形状被 isEmotionInstalled 认", () => {
    const userData = DIR as string;
    expect(runtimeDir(userData)).toContain(EMOTION_RUNTIME_VERSION);
    expect(modelDir(userData)).toContain(EMOTION_MODEL_ID);
    expect(isEmotionInstalled(userData)).toBe(true);
  });
});
