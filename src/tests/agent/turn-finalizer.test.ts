import { beforeEach, describe, expect, it, vi } from "vitest";

const configState = vi.hoisted(() => ({ autoSkillLearning: true }));

vi.mock("../../main/config/config-store", () => ({
  configStore: {
    getAll: () => ({ autoSkillLearning: configState.autoSkillLearning }),
  },
}));

import type { Message } from "../../renderer/types";
import type { BackgroundReviewService } from "../../main/agent/background-review";
import { TurnFinalizer } from "../../main/agent/turn-finalizer";

function messages(turn: number): Message[] {
  return [
    {
      id: `user-${turn}`,
      sessionId: "session-1",
      role: "user",
      content: [{ type: "text", text: `user turn ${turn}` }],
      timestamp: turn * 2,
    },
    {
      id: `assistant-${turn}`,
      sessionId: "session-1",
      role: "assistant",
      content: [{ type: "text", text: `assistant turn ${turn}` }],
      timestamp: turn * 2 + 1,
    },
  ];
}

function completeTurn(
  finalizer: TurnFinalizer,
  turn: number,
  isProjectMode = false,
): void {
  finalizer.onTurnComplete({
    sessionId: "session-1",
    messages: messages(turn),
    hasFinalResponse: true,
    interrupted: false,
    isProjectMode,
  });
}

function createFinalizer(review: ReturnType<typeof vi.fn>): TurnFinalizer {
  return new TurnFinalizer({
    skillReviewInterval: 3,
    getReviewService: () => ({ review }) as unknown as BackgroundReviewService,
  });
}

describe("TurnFinalizer", () => {
  beforeEach(() => {
    configState.autoSkillLearning = true;
  });

  it("runs only at the configured skill-review interval", async () => {
    const review = vi.fn(async () => undefined);
    const finalizer = createFinalizer(review);

    completeTurn(finalizer, 1);
    completeTurn(finalizer, 2);
    expect(review).not.toHaveBeenCalled();

    completeTurn(finalizer, 3);
    await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(1));
  });

  it("does not run a hidden memory review when skill learning is disabled", async () => {
    configState.autoSkillLearning = false;
    const review = vi.fn(async () => undefined);
    const finalizer = createFinalizer(review);

    for (let turn = 1; turn <= 6; turn += 1) {
      completeTurn(finalizer, turn);
    }
    await Promise.resolve();

    expect(review).not.toHaveBeenCalled();
  });

  it("skips skill review in project mode", async () => {
    const review = vi.fn(async () => undefined);
    const finalizer = createFinalizer(review);

    completeTurn(finalizer, 1, true);
    completeTurn(finalizer, 2, true);
    completeTurn(finalizer, 3, true);
    await Promise.resolve();

    expect(review).not.toHaveBeenCalled();
  });
});
