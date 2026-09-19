import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

function resetStore(): void {
  useAppStore.setState(useAppStore.getInitialState());
}

describe("update readiness store", () => {
  beforeEach(resetStore);

  it("starts with no pending update", () => {
    const state = useAppStore.getState();
    expect(state.updateReady).toBe(false);
    expect(state.updateVersion).toBe("");
    expect(state.updateNotes).toBeNull();
  });

  it("stores the version and notes of a downloaded update", () => {
    useAppStore.getState().setUpdateReady("1.0.38", '{"zh":"中文","en":"en"}');

    const state = useAppStore.getState();
    expect(state.updateReady).toBe(true);
    expect(state.updateVersion).toBe("1.0.38");
    expect(state.updateNotes).toBe('{"zh":"中文","en":"en"}');
  });

  it("clears stale notes when a check reports no update", () => {
    useAppStore.getState().setUpdateReady("1.0.38", '{"zh":"旧","en":"old"}');
    useAppStore.getState().setUpdateReady(null, null);

    const state = useAppStore.getState();
    expect(state.updateReady).toBe(false);
    expect(state.updateVersion).toBe("");
    expect(state.updateNotes).toBeNull();
  });
});
