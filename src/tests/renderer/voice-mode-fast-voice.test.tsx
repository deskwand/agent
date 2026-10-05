// @vitest-environment jsdom
/**
 * 语音模式要按设置里的「高速音色」开关决定传不传 `prefer`。
 *
 * 这是把开关接上引擎的**唯一**一处接线，而且断了不会报错：服务层会安静地回退到
 * 朗读的模型，症状只有"又变慢了"。所以把它钉住。
 *
 * 与设置卡那个开关的分工：那个开关管写入与显示，这里只管**读**（每句读一次）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { AppConfig } from "../../renderer/types";
import type { StreamingSpeechDeps } from "../../renderer/hooks/useStreamingSpeech";

const runtime = vi.hoisted(() => ({
  speechDeps: [] as StreamingSpeechDeps[],
}));

vi.mock("../../renderer/hooks/useReadAloud", () => ({
  stopReadAloud: vi.fn(),
}));
vi.mock("../../renderer/hooks/useStreamingSpeech", () => ({
  createStreamingSpeech: (deps: StreamingSpeechDeps) => {
    runtime.speechDeps.push(deps);
    return {};
  },
}));
vi.mock("../../renderer/hooks/useVoiceConversation", () => ({
  createVoiceConversation: () => ({
    start: async () => {},
    stop: vi.fn(),
    setBlocked: vi.fn(),
    sendAnswerDelta: vi.fn(),
  }),
}));

import { useVoiceMode } from "../../renderer/hooks/useVoiceMode";

function Harness() {
  useVoiceMode({ sessionId: "V", isCompacting: false, sendQuestion: vi.fn() });
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  runtime.speechDeps.length = 0;
});

/** 每个用例的脚手架：stub AudioContext 与 tts.speak、建一个语音会话并打开浮层。 */
async function mount(opts: { fastVoice?: boolean } = {}) {
  const speak = vi.fn(async () => ({
    ok: true as const,
    samples: new Float32Array(1),
    sampleRate: 16000,
  }));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "AudioContext",
    class {
      close = vi.fn();
    },
  );
  vi.stubGlobal("electronAPI", undefined);
  window.electronAPI = { tts: { speak } } as never;

  // 这一句会把 appConfig 清掉，所以要设开关必须在它**之后**（或走 opts）
  useAppStore.setState(useAppStore.getInitialState(), true);
  if (opts.fastVoice !== undefined) setFastVoice(opts.fastVoice);
  const store = useAppStore.getState();
  store.addSession({
    id: "V",
    kind: "voice",
    title: "Voice",
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  });
  store.setActiveSession("V");
  store.openVoiceMode("V");

  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  return {
    speak,
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

/** 说一句：走 useVoiceMode 交给 createStreamingSpeech 的那个 speak。 */
const say = (text: string) =>
  act(async () => runtime.speechDeps[0].speak(text));

/** 只填本用例会读的字段。 */
const setFastVoice = (fastVoice: boolean) =>
  useAppStore.getState().setAppConfig({
    voiceMode: { silenceMs: 1200, fastVoice },
  } as AppConfig);

it("asks for the fast voice while the switch is on", async () => {
  // 默认就是开（DEFAULT_VOICE_MODE.fastVoice === true）
  const { speak, unmount } = await mount();
  try {
    await say("你好。");
    expect(speak).toHaveBeenCalledExactlyOnceWith("你好。", {
      prefer: "matcha",
    });
  } finally {
    await unmount();
  }
});

it("sends no options while the switch is off", async () => {
  const { speak, unmount } = await mount({ fastVoice: false });
  try {
    await say("你好。");
    // 实现里保持两参调用形状（speak(text, opts)），所以这里断言第二个参数是 undefined
    expect(speak).toHaveBeenCalledExactlyOnceWith("你好。", undefined);
  } finally {
    await unmount();
  }
});

it("reads the switch on every sentence, so flipping it takes effect at once", async () => {
  // 打开浮层之后才关掉开关：下一句就得换回朗读音色（不用重开浮层）
  const { speak, unmount } = await mount();
  try {
    await say("第一句。");
    setFastVoice(false);
    await say("第二句。");
    expect(speak).toHaveBeenLastCalledWith("第二句。", undefined);
  } finally {
    await unmount();
  }
});
