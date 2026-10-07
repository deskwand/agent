// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// speakStream 是"最后一厘米"：override 有没有真的送到它手上，只有这里能守得住。
// 之前差点犯的错正是这一层 —— 渲染侧自己解析档位，会在 appConfig 未同步时静默降级。
vi.mock("../../renderer/utils/tts/speak-stream", () => ({
  speakStream: vi.fn(() => () => {}),
}));

import { defaultDeps } from "../../renderer/hooks/useReadAloud";
import { useAppStore } from "../../renderer/store";
import type { AppConfig } from "../../renderer/types";
import { speakStream } from "../../renderer/utils/tts/speak-stream";

const mocked = vi.mocked(speakStream);
const handlers = { onChunk: () => {}, onDone: () => {}, onError: () => {} };

function setTone(tone: "fast" | "balanced" | "best"): void {
  useAppStore.setState({
    appConfig: { voiceMode: { tone } } as unknown as AppConfig,
  });
}

describe("朗读档位：从设置到引擎请求的那一厘米", () => {
  beforeEach(() => {
    mocked.mockClear();
  });

  it("最佳档 + 多段 → 真的带着 balanced 发出去", () => {
    setTone("best");
    defaultDeps().speak("第一句。", handlers, { segmentCount: 2 });
    expect(mocked).toHaveBeenCalledWith(
      "第一句。",
      { tone: "balanced" },
      handlers,
    );
  });

  it("最佳档 + 单段 → 不带覆盖，仍由主进程按设置解析", () => {
    setTone("best");
    defaultDeps().speak("只有一句。", handlers, { segmentCount: 1 });
    expect(mocked).toHaveBeenCalledWith("只有一句。", undefined, handlers);
  });

  it("不是最佳档 → 一个字都不多传（行为与改动前逐字一致）", () => {
    setTone("balanced");
    defaultDeps().speak("第一句。", handlers, { segmentCount: 9 });
    expect(mocked).toHaveBeenCalledWith("第一句。", undefined, handlers);
  });

  it("渲染侧 store 还没同步 → 不能自己造一个档位出来", () => {
    useAppStore.setState({ appConfig: undefined });
    defaultDeps().speak("第一句。", handlers, { segmentCount: 9 });
    expect(mocked).toHaveBeenCalledWith("第一句。", undefined, handlers);
  });
});
