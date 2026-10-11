/**
 * @module renderer/capabilities/catalog
 *
 * 「本机能力」的三行数据与状态推导。**纯函数**：不碰 IPC、不读 store ——
 * 欢迎页、门的判据、测试读的是同一份规则。
 *
 * 显示状态与门的动作是**两个不同的问题**，别合并：
 * - 显示（本文件 `deriveCapabilityStates`）：开关优先 —— 没开就是 `off`，
 *   哪怕模型已经装好（"开"这件事要写开关）。
 * - 动作（`capability-gate.ts` 的 `decideGateAction`）：安装优先 —— 没装就先问下载，
 *   确认之后才写开关（沿用 2026-10-04 voice-inline-enable 设计 §0.5）。
 */
import type {
  OcrInstallState,
  TtsInstallStates,
  VoiceInstallState,
} from "../../shared/ipc-types";
import { resolveTtsSource } from "../../shared/voice-mode";

export type CapabilityId = "voiceInput" | "voice" | "ocr";

export type CapabilityState =
  | "off"
  | "needsDownload"
  | "downloading"
  | "ready"
  | "error";

/** 三路安装态。null = 还没读到（IPC 未回 / 读失败）—— 一律按"未装"处理。 */
export interface CapabilityInstalls {
  voiceInput: VoiceInstallState | null;
  voice: TtsInstallStates | null;
  ocr: OcrInstallState | null;
}

/**
 * 只看能力相关的几项。用**结构类型**而不是完整 AppConfig：测试里不必造一个
 * 几百字段的假配置，而 store 里的 AppConfig 结构上就能赋给它。
 */
export interface CapabilityConfigView {
  voiceEngine?: { enabled?: boolean };
  ocr?: { enabled?: boolean };
  voiceMode?: unknown;
}

export interface CapabilitySpec {
  id: CapabilityId;
  titleKey: string;
  descKey: string;
  /** 体积（MB）。i18n 文案里的数字由测试对着它，别在两处手写。 */
  sizeMb: number;
  /** 有没有开关。`voice` 没有：朗读 always on（提交 fd22fb64）。 */
  hasSwitch: boolean;
}

export const CAPABILITIES: readonly CapabilitySpec[] = [
  {
    id: "voiceInput",
    titleKey: "capabilityIntro.voiceInput.title",
    descKey: "capabilityIntro.voiceInput.desc",
    sizeMb: 140,
    hasSwitch: true,
  },
  {
    id: "voice",
    titleKey: "capabilityIntro.voice.title",
    descKey: "capabilityIntro.voice.desc",
    sizeMb: 130,
    hasSwitch: false,
  },
  {
    id: "ocr",
    titleKey: "capabilityIntro.ocr.title",
    descKey: "capabilityIntro.ocr.desc",
    sizeMb: 65,
    hasSwitch: true,
  },
];

export function capabilitySizeTotalMb(): number {
  return CAPABILITIES.reduce((sum, spec) => sum + spec.sizeMb, 0);
}

/** 与 settings/shared.tsx 的 BUSY_PHASES 同一组词（那边多两个引擎档的阶段）。 */
const BUSY_PHASES = new Set([
  "downloading",
  "extracting",
  "checking",
  "installing",
]);

function installedOf(id: CapabilityId, installs: CapabilityInstalls): boolean {
  switch (id) {
    case "voiceInput":
      return installs.voiceInput?.installed === true;
    case "voice":
      // 只装英文不算：中文文本会路由到没装的 zh，那一下是没声音的。
      return (
        installs.voice?.zh?.installed === true ||
        installs.voice?.matcha?.installed === true
      );
    case "ocr":
      return installs.ocr?.installed === true;
  }
}

/** 三路状态聚成一个"这一行现在在忙什么"的相位（只给 voice 那行用）。 */
function voicePhase(installs: TtsInstallStates | null): string {
  if (!installs) return "idle";
  const all = [installs.zh, installs.en, installs.matcha];
  const busy = all.find((state) => BUSY_PHASES.has(state.phase));
  if (busy) return busy.phase;
  return "idle";
}

export function deriveCapabilityStates(
  config: CapabilityConfigView | null,
  installs: CapabilityInstalls,
): Record<CapabilityId, CapabilityState> {
  const out = {} as Record<CapabilityId, CapabilityState>;
  for (const spec of CAPABILITIES) {
    const enabled =
      !spec.hasSwitch ||
      (spec.id === "voiceInput"
        ? config?.voiceEngine?.enabled === true
        : config?.ocr?.enabled === true);
    const phase =
      spec.id === "voice"
        ? voicePhase(installs.voice)
        : spec.id === "voiceInput"
          ? (installs.voiceInput?.phase ?? "idle")
          : (installs.ocr?.phase ?? "idle");
    if (phase === "error") {
      out[spec.id] = "error";
      continue;
    }
    if (BUSY_PHASES.has(phase)) {
      out[spec.id] = "downloading";
      continue;
    }
    if (!enabled) {
      out[spec.id] = "off";
      continue;
    }
    out[spec.id] = installedOf(spec.id, installs) ? "ready" : "needsDownload";
  }
  return out;
}

/**
 * 「语音」那一行要不要画。云端来源（且真的配了 provider）时它不是本机能力，
 * 不占这一行的位置；**只填了一半的云端**仍要显示本机行 —— 否则用户既没有云端
 * 也没有本机，"语音"这件事会从清单里整块消失。
 */
export function isVoiceRowVisible(voiceMode: unknown): boolean {
  if (resolveTtsSource(voiceMode) !== "cloud") return true;
  const provider = (voiceMode as { cloud?: { provider?: unknown } } | undefined)
    ?.cloud?.provider;
  return typeof provider !== "string" || provider.length === 0;
}

export function visibleCapabilityIds(
  config: CapabilityConfigView | null,
): CapabilityId[] {
  return CAPABILITIES.filter(
    (spec) => spec.id !== "voice" || isVoiceRowVisible(config?.voiceMode),
  ).map((spec) => spec.id);
}

export interface CapabilityQueueView {
  running: CapabilityId | null;
  positions: Partial<Record<CapabilityId, number>>;
}

export interface CapabilityRowView {
  id: CapabilityId;
  /** `queued` 是队列叠上去的第六态（见 capability-gate）。 */
  state: CapabilityState | "queued";
  /** 0–100，只有 `downloading` 有意义。 */
  percent: number;
}

export function buildCapabilityRows(
  config: CapabilityConfigView | null,
  installs: CapabilityInstalls,
  queue: CapabilityQueueView,
): CapabilityRowView[] {
  const states = deriveCapabilityStates(config, installs);
  return visibleCapabilityIds(config).map((id) => ({
    id,
    state: queue.positions[id] === undefined ? states[id] : "queued",
    percent:
      id === "voiceInput"
        ? (installs.voiceInput?.percent ?? 0)
        : id === "ocr"
          ? (installs.ocr?.percent ?? 0)
          : Math.max(
              installs.voice?.zh?.percent ?? 0,
              installs.voice?.matcha?.percent ?? 0,
            ),
  }));
}
