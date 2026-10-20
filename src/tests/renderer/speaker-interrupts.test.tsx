// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSpeakerInterrupts } from "../../renderer/hooks/useFeedListen";
import { useAppStore } from "../../renderer/store";

function Harness(): JSX.Element {
  useSpeakerInterrupts();
  return <div />;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const statuses = () => ({
  readAloud: useAppStore.getState().readAloud.status,
  feedListen: useAppStore.getState().feedListen.status,
  selectionSpeech: useAppStore.getState().selectionSpeech.status,
});

describe("三说话者互停", () => {
  it("划词朗读起播 → 停掉另两个", () => {
    act(() => {
      useAppStore.setState({
        readAloud: { ...useAppStore.getState().readAloud, status: "playing" },
        feedListen: { ...useAppStore.getState().feedListen, status: "playing" },
      });
    });
    // 上面那一下本身已经互斥：feedListen 起播会把 readAloud 停掉。
    act(() => useAppStore.getState().setSelectionSpeech({ status: "playing" }));
    expect(statuses()).toEqual({
      readAloud: "idle",
      feedListen: "idle",
      selectionSpeech: "playing",
    });
  });

  it("订阅收听起播 → 停掉划词朗读", () => {
    act(() => useAppStore.getState().setSelectionSpeech({ status: "playing" }));
    act(() => useAppStore.getState().setFeedListen({ status: "playing" }));
    expect(statuses()).toEqual({
      readAloud: "idle",
      feedListen: "playing",
      selectionSpeech: "idle",
    });
  });

  it("整条朗读起播 → 停掉订阅收听", () => {
    act(() => useAppStore.getState().setFeedListen({ status: "playing" }));
    act(() =>
      useAppStore.setState({
        readAloud: { ...useAppStore.getState().readAloud, status: "playing" },
      }),
    );
    expect(statuses().feedListen).toBe("idle");
  });

  it("语音模式打开 → 收听与划词朗读都停", () => {
    // 两路不可能同时在播（互停就是为了这个），所以分开验。
    act(() => useAppStore.getState().setSelectionSpeech({ status: "playing" }));
    act(() => useAppStore.setState({ voiceModeOpen: true }));
    expect(statuses().selectionSpeech).toBe("idle");

    act(() => useAppStore.setState({ voiceModeOpen: false }));
    act(() => useAppStore.getState().setFeedListen({ status: "playing" }));
    expect(statuses().feedListen).toBe("playing");
    act(() => useAppStore.setState({ voiceModeOpen: true }));
    expect(statuses().feedListen).toBe("idle");
  });
});
