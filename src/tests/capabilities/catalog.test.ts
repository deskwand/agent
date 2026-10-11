import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  buildCapabilityRows,
  capabilitySizeTotalMb,
  deriveCapabilityStates,
  isVoiceRowVisible,
  visibleCapabilityIds,
  type CapabilityInstalls,
} from "../../renderer/capabilities/catalog";

const none: CapabilityInstalls = { voiceInput: null, voice: null, ocr: null };

/** 三件套各自的"就绪"安装态。 */
const installedAll: CapabilityInstalls = {
  voiceInput: { phase: "ready", percent: 100, installed: true },
  voice: {
    zh: { phase: "ready", percent: 100, installed: true },
    en: { phase: "idle", percent: 0, installed: false },
    matcha: { phase: "idle", percent: 0, installed: false },
  },
  ocr: { phase: "ready", percent: 100, installed: true },
};

describe("能力状态推导", () => {
  it("有开关的能力：开关没开就是 off，哪怕模型已装", () => {
    const states = deriveCapabilityStates(
      { voiceEngine: { enabled: false }, ocr: { enabled: false } },
      installedAll,
    );
    expect(states.voiceInput).toBe("off");
    expect(states.ocr).toBe("off");
  });

  it("开了但没装 → needsDownload", () => {
    const states = deriveCapabilityStates(
      { voiceEngine: { enabled: true }, ocr: { enabled: true } },
      none,
    );
    expect(states.voiceInput).toBe("needsDownload");
    expect(states.ocr).toBe("needsDownload");
  });

  it("开着且装着 → ready", () => {
    const states = deriveCapabilityStates(
      { voiceEngine: { enabled: true }, ocr: { enabled: true } },
      installedAll,
    );
    expect(states.voiceInput).toBe("ready");
    expect(states.ocr).toBe("ready");
    expect(states.voice).toBe("ready");
  });

  it("语音没有开关：装上任一小模型（zh 或 matcha）就算就绪，只装英文不算", () => {
    const onlyEn: CapabilityInstalls = {
      ...none,
      voice: {
        zh: { phase: "idle", percent: 0, installed: false },
        en: { phase: "ready", percent: 100, installed: true },
        matcha: { phase: "idle", percent: 0, installed: false },
      },
    };
    expect(deriveCapabilityStates(null, onlyEn).voice).toBe("needsDownload");

    const matchaOnly: CapabilityInstalls = {
      ...none,
      voice: {
        zh: { phase: "idle", percent: 0, installed: false },
        en: { phase: "idle", percent: 0, installed: false },
        matcha: { phase: "ready", percent: 100, installed: true },
      },
    };
    expect(deriveCapabilityStates(null, matchaOnly).voice).toBe("ready");
  });

  it("下载中与失败各自成一态（优先于开关）", () => {
    const busy: CapabilityInstalls = {
      voiceInput: { phase: "downloading", percent: 42, installed: false },
      voice: null,
      ocr: { phase: "error", percent: 0, installed: false, error: "boom" },
    };
    const states = deriveCapabilityStates(
      { voiceEngine: { enabled: false }, ocr: { enabled: false } },
      busy,
    );
    expect(states.voiceInput).toBe("downloading");
    expect(states.ocr).toBe("error");
  });

  it("配置为 null（还没读到）不抛错", () => {
    expect(deriveCapabilityStates(null, none)).toEqual({
      voiceInput: "off",
      voice: "needsDownload",
      ocr: "off",
    });
  });
});

describe("语音那一行的可见性", () => {
  it("本机来源 → 显示", () => {
    expect(isVoiceRowVisible(undefined)).toBe(true);
    expect(isVoiceRowVisible({ source: "local" })).toBe(true);
  });

  it("云端来源且填了 provider → 不显示（它不是本机能力）", () => {
    expect(
      isVoiceRowVisible({ source: "cloud", cloud: { provider: "doubao" } }),
    ).toBe(false);
    expect(
      visibleCapabilityIds({
        voiceMode: { source: "cloud", cloud: { provider: "doubao" } },
      }),
    ).toEqual(["voiceInput", "ocr"]);
  });

  it("云端只填了一半（没 provider）→ 仍显示：否则用户既没有云端也没有本机", () => {
    expect(isVoiceRowVisible({ source: "cloud", cloud: {} })).toBe(true);
  });
});

describe("行视图", () => {
  it("排队中的行报 queued，正在下载的行报 downloading + 百分比", () => {
    const rows = buildCapabilityRows(
      { voiceEngine: { enabled: true }, ocr: { enabled: true } },
      {
        voiceInput: { phase: "downloading", percent: 42, installed: false },
        voice: null,
        ocr: null,
      },
      { running: "voiceInput", positions: { ocr: 1 } },
    );
    expect(rows.map((row) => [row.id, row.state, row.percent])).toEqual([
      ["voiceInput", "downloading", 42],
      ["voice", "needsDownload", 0],
      ["ocr", "queued", 0],
    ]);
  });

  it("合计体积 = 三行之和", () => {
    expect(capabilitySizeTotalMb()).toBe(335);
    expect(CAPABILITIES.map((spec) => spec.sizeMb)).toEqual([140, 130, 65]);
  });

  it("全就绪时三行都是 ready —— 没有一行需要动作（块还没写 dismissedAt 也不会出现下载按钮）", () => {
    const rows = buildCapabilityRows(
      { voiceEngine: { enabled: true }, ocr: { enabled: true } },
      installedAll,
      { running: null, positions: {} },
    );
    expect(rows.map((row) => row.state)).toEqual(["ready", "ready", "ready"]);
  });
});
