// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  useSessionActiveTurn,
  useSessionExecutionClock,
  useSessionMessages,
  useSessionPartialMessage,
  useSessionPendingTurns,
} from "../../renderer/store/selectors";
import type { Message, TurnState } from "../../renderer/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  messages: Message[];
  partial: string;
  turn: TurnState | null;
  pending: TurnState[];
  clock: unknown;
}

let container: HTMLDivElement;
let root: Root;
let snapshots: Snapshot[];

function Probe({ sessionId }: { sessionId: string | null }): null {
  snapshots.push({
    messages: useSessionMessages(sessionId),
    partial: useSessionPartialMessage(sessionId),
    turn: useSessionActiveTurn(sessionId),
    pending: useSessionPendingTurns(sessionId),
    clock: useSessionExecutionClock(sessionId),
  });
  return null;
}

async function render(sessionId: string | null): Promise<Snapshot> {
  await act(async () => {
    root.render(<Probe sessionId={sessionId} />);
  });
  return snapshots[snapshots.length - 1];
}

beforeEach(() => {
  snapshots = [];
  useAppStore.setState({ sessionStates: {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("per-session selectors", () => {
  it("读取指定会话而不是全局 activeSessionId", async () => {
    useAppStore.setState((s) => ({
      activeSessionId: "S1",
      sessionStates: {
        ...s.sessionStates,
        S2: {
          ...(s.sessionStates.S2 ?? {}),
          partialMessage: "streaming",
          pendingTurns: [{ id: "t1" } as unknown as TurnState],
        } as never,
      },
    }));
    const snap = await render("S2");
    expect(snap.partial).toBe("streaming");
    expect(snap.pending).toHaveLength(1);
  });

  it("null 与未知会话返回稳定的空值", async () => {
    const first = await render(null);
    expect(first.partial).toBe("");
    expect(first.turn).toBeNull();
    expect(first.clock).toBeUndefined();
    const second = await render("missing");
    expect(second.messages).toBe(first.messages);
    expect(second.pending).toBe(first.pending);
    const again = await render(null);
    expect(again.pending).toBe(first.pending);
  });
});
