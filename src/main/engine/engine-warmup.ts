/**
 * @module main/engine/engine-warmup
 *
 * 安装收尾的预热：起进程 → 合成一句 → 确认真的收到了音频。
 *
 * 为什么单独一个模块而不是写在 `engine-installer.ts` 里：安装器 ← 桥接 ←
 * 监督器 ← 安装器（监督器要 `enginePaths`），写进去就是一个循环导入。
 *
 * 预热吃掉的是引擎的**首次冷启动**（实测 19.8s，Metal kernel 编译）。把它留在
 * 安装时，用户第一次说话才是热启动（0.53–0.83s）；失败则让安装整体回滚 ——
 * "装完但跑不动"是最坏的结果。
 */
import { ENGINE_VOICE_DEFAULT } from "../../shared/engine-install";
import { speakViaEngine } from "./engine-bridge";
import { getEngineSupervisor } from "./engine-supervisor";

/** 与 sherpa 的自检句同一处理方式：产物丢弃，不给用户看。 */
const WARMUP_TEXT = "语音引擎自检，共 12 个字。"; // i18n-allow-cjk 自检用语

export async function warmupEngine(): Promise<void> {
  const supervisor = getEngineSupervisor();
  // 重装/重试要清掉上一次留下的 failed 与崩溃计数，否则第一次预热就被自己挡住
  supervisor.reset();

  let gotAudio = false;
  const result = await speakViaEngine(
    {
      text: WARMUP_TEXT,
      voiceId: ENGINE_VOICE_DEFAULT,
      streamId: 0, // 负数/零：与真实流不碰撞
      send: (event) => {
        if (event.type === "chunk") gotAudio = true;
      },
    },
    { supervisor },
  );
  if (!result.ok) throw new Error(result.error);
  if (!gotAudio) throw new Error("engine produced no audio");
}
