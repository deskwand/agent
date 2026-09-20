// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  OFFICE_PREVIEW_BUSY_DELAY_MS,
  openOfficePreview,
} from "../../renderer/utils/office-preview-runner";

/** 手动控制 resolve 时机的 promise。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("openOfficePreview", () => {
  let render: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState(useAppStore.getInitialState());
    render = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { file: { renderOfficePreview: render } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not show a busy state when the render finishes before the delay", async () => {
    render.mockResolvedValue({ ok: true, outPath: "/tmp/a.html" });
    const onSuccess = vi.fn();

    await openOfficePreview("/repo/a.docx", { onSuccess, onFailure: vi.fn() });

    expect(useAppStore.getState().officePreviewBusyPath).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith("/tmp/a.html");
  });

  it("shows a busy state on the clicked path once the delay elapses", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    expect(useAppStore.getState().officePreviewBusyPath).toBeNull();

    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);
    expect(useAppStore.getState().officePreviewBusyPath).toBe("/repo/a.docx");

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await done;
    expect(useAppStore.getState().officePreviewBusyPath).toBeNull();
  });

  it("drops a superseded render so only the newest result lands", async () => {
    const first = deferred<{ ok: boolean; outPath?: string }>();
    const second = deferred<{ ok: boolean; outPath?: string }>();
    render
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();
    const firstRun = openOfficePreview("/repo/a.docx", {
      onSuccess: firstSuccess,
      onFailure: vi.fn(),
    });
    const secondRun = openOfficePreview("/repo/b.xlsx", {
      onSuccess: secondSuccess,
      onFailure: vi.fn(),
    });

    // 先回来的那个是"过期"的
    first.resolve({ ok: true, outPath: "/tmp/a.html" });
    await firstRun;
    expect(firstSuccess).not.toHaveBeenCalled();

    second.resolve({ ok: true, outPath: "/tmp/b.html" });
    await secondRun;
    expect(secondSuccess).toHaveBeenCalledWith("/tmp/b.html");
    expect(useAppStore.getState().officePreviewBusyPath).toBeNull();
  });

  it("calls onFailure when the render reports a failure", async () => {
    render.mockResolvedValue({ ok: false, reason: "binary-missing" });
    const onFailure = vi.fn();

    await openOfficePreview("/repo/a.docx", { onSuccess: vi.fn(), onFailure });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("calls onFailure when the api is unavailable", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {},
    });
    const onFailure = vi.fn();

    await openOfficePreview("/repo/a.docx", { onSuccess: vi.fn(), onFailure });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("calls onFailure when the ipc call rejects", async () => {
    render.mockRejectedValue(new Error("ipc down"));
    const onFailure = vi.fn();

    await openOfficePreview("/repo/a.docx", { onSuccess: vi.fn(), onFailure });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
