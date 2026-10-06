/**
 * @module shared/engine-install
 *
 * 「最佳音质」档引擎的安装状态。引擎是上游 `qwentts.cpp` 的 `tts-server`
 * 二进制 + 两个 GGUF 模型，**按平台单独下载**，不随应用包发布。
 *
 * 与 sherpa 的 `TtsInstallState` **分开**：那份是"下一个 tar 包、解到模型目录"，
 * 这份是"引擎产物 + 两个 GGUF + 预热"。阶段与失败原因都不同，合并会让两边
 * 的 phase 互相将就（sherpa 的 extracting 在这条路上没有对应物）。
 */

export type EngineInstallPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "installing"
  | "ready"
  | "error";

/**
 * 装不了的原因。三种各有一条文案 —— 用户看到"不可用"必须知道为什么，
 * 以及"是不是我换台机器就行"。
 */
export type EngineBlockedReason = "disk" | "memory" | "platform";

export interface EngineInstallState {
  phase: EngineInstallPhase;
  /** 0-100。 */
  percent: number;
  installed: boolean;
  error?: string;
  blockedReason?: EngineBlockedReason;
}

/**
 * 缺省音色。第一次装完就是这个，用户没选过也不会没声音。
 * `vivian` 是九个预置音色里我们试听过的那个（试听页 v9）。
 */
export const ENGINE_VOICE_DEFAULT = "vivian";

/**
 * 九个预置音色，**原样取自模型元数据** `speaker_names` / `speaker_dialects`。
 * 不自己发明中文名：名字对不上模型时会让人以为选错了声音。
 *
 * 方言标记来自元数据（只有两个音色有方言）。
 */
export const ENGINE_VOICES: { id: string; dialect?: string }[] = [
  { id: "serena" },
  { id: "vivian" },
  { id: "uncle_fu" },
  { id: "ryan" },
  { id: "aiden" },
  { id: "ono_anna" },
  { id: "sohee" },
  { id: "eric", dialect: "sichuan_dialect" },
  { id: "dylan", dialect: "beijing_dialect" },
];
