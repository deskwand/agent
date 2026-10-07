import { describe, expect, it } from "vitest";
import { readAloudToneOverride } from "../../shared/voice-mode";

/**
 * 朗读档位：**只有「用户选了最佳音质 + 这次朗读不止一段」才覆盖成均衡**。
 *
 * 起因是"朗读时会切换多个角色"——最佳档每段一次独立请求、各自重新采样，段落之间
 * 音色会跳（实测偶发整段高八度）；均衡档是固定音色模型，结构上不会换人。
 *
 * 其余情况必须返回 undefined 而不是解析出来的档位：朗读原本不传 tone、由主进程按
 * 设置解析，渲染侧自己解析会在 `appConfig` 尚未同步时把档位静默降级。
 */
describe("朗读档位覆盖", () => {
  it("最佳档 + 多段 → 覆盖成均衡", () => {
    expect(readAloudToneOverride({ tone: "best" }, 2)).toBe("balanced");
    expect(readAloudToneOverride({ tone: "best" }, 9)).toBe("balanced");
  });

  it("最佳档 + 单段 → 不覆盖（没有跨段漂移问题）", () => {
    expect(readAloudToneOverride({ tone: "best" }, 1)).toBeUndefined();
  });

  it("其余情况一律不覆盖 —— 交给主进程按设置解析，行为与改动前一致", () => {
    expect(readAloudToneOverride({ tone: "balanced" }, 5)).toBeUndefined();
    expect(readAloudToneOverride({ tone: "fast" }, 5)).toBeUndefined();
    expect(readAloudToneOverride({ fastVoice: true }, 3)).toBeUndefined();
    expect(readAloudToneOverride({ fastVoice: false }, 3)).toBeUndefined();
    // 渲染侧 store 还没同步时不能自行解析，否则会把档位静默降级
    expect(readAloudToneOverride(undefined, 3)).toBeUndefined();
  });
});
