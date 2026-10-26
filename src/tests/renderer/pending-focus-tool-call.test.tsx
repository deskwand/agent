// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePendingFocusToolCall } from "../../renderer/hooks/use-pending-focus-tool-call";
import { useAppStore } from "../../renderer/store";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ onFocus }: { onFocus: (toolCallId: string) => void }) {
  usePendingFocusToolCall(onFocus);
  return <div />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("usePendingFocusToolCall", () => {
  it("consumes the request once and clears it", async () => {
    const onFocus = vi.fn();
    useAppStore.getState().requestFocusToolCall("call-1");

    await act(async () => {
      root.render(<Probe onFocus={onFocus} />);
    });

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith("call-1");
    expect(useAppStore.getState().pendingFocusToolCallId).toBeNull();
  });

  it("does nothing while there is no request", async () => {
    const onFocus = vi.fn();

    await act(async () => {
      root.render(<Probe onFocus={onFocus} />);
    });

    expect(onFocus).not.toHaveBeenCalled();
  });
});
