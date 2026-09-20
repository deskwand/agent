// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  OFFICE_PREVIEW_BUSY_DELAY_MS,
  openOfficePreview,
} from "../../renderer/utils/office-preview-runner";

/** 手动控制 resolve 时机的 promise。 */
/** 测试里注入的取词函数：直接把 key 当文案，断言因此与语言无关。 */
const t = (key: string) => key;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("openOfficePreview", () => {
  let render: ReturnType<typeof vi.fn>;
  let getStatus: ReturnType<typeof vi.fn>;
  let showStatusPage: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let restorePreviousPage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState(useAppStore.getInitialState());
    render = vi.fn();
    getStatus = vi.fn(async () => ({ visible: false, url: "about:blank" }));
    showStatusPage = vi.fn(async () => ({}));
    navigate = vi.fn(async () => ({}));
    restorePreviousPage = vi.fn(
      async (): Promise<"restored" | "nothing-to-restore" | "no-previous"> =>
        "no-previous",
    );
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        file: { renderOfficePreview: render },
        browser: { getStatus, showStatusPage, navigate, restorePreviousPage },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not show a busy state when the render finishes before the delay", async () => {
    render.mockResolvedValue({ ok: true, outPath: "/tmp/a.html" });
    const onSuccess = vi.fn();

    await openOfficePreview("/repo/a.docx", {
      t,
      onSuccess,
      onFailure: vi.fn(),
    });

    expect(useAppStore.getState().officePreviewBusyPath).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith("/tmp/a.html");
  });

  it("shows a busy state on the clicked path once the delay elapses", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
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
      t,
      onSuccess: firstSuccess,
      onFailure: vi.fn(),
    });
    const secondRun = openOfficePreview("/repo/b.xlsx", {
      t,
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

    await openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("calls onFailure when the api is unavailable", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {},
    });
    const onFailure = vi.fn();

    await openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("calls onFailure when the ipc call rejects", async () => {
    render.mockRejectedValue(new Error("ipc down"));
    const onFailure = vi.fn();

    await openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when the render finishes before the delay", async () => {
    render.mockResolvedValue({ ok: true, outPath: "/tmp/a.html" });

    await openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });

    expect(showStatusPage).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
    expect(useAppStore.getState().globalNotice).toBeNull();
  });

  it("opens the panel with a waiting page when the panel is closed", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);

    expect(showStatusPage).toHaveBeenCalledWith(
      "filePreview.officePreviewLoading",
      "loading",
    );
    expect(useAppStore.getState().rightPanelMode).toBe("browser");

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await done;
  });

  it("shows the waiting page even when the panel is on another document", async () => {
    useAppStore.setState({ rightPanelMode: "browser" });
    getStatus.mockResolvedValue({
      visible: true,
      url: "file:///tmp/other.pdf",
    });
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);

    // P3：只有一条等待路径，不再有 toast
    expect(showStatusPage).toHaveBeenCalledWith(
      "filePreview.officePreviewLoading",
      "loading",
    );
    expect(useAppStore.getState().globalNotice).toBeNull();

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await done;
  });

  it("still shows the waiting page when getStatus throws", async () => {
    useAppStore.setState({ rightPanelMode: "browser" });
    getStatus.mockRejectedValue(new Error("ipc down"));
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);

    // 取不到原页面只是"不能还原"，不影响给出等待反馈
    expect(showStatusPage).toHaveBeenCalledWith(
      "filePreview.officePreviewLoading",
      "loading",
    );

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await done;
  });

  it("restores the previous page when the main process can", async () => {
    useAppStore.setState({ rightPanelMode: "browser" });
    restorePreviousPage.mockResolvedValue("restored");
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);

    gate.resolve({ ok: false });
    await done;
    await vi.advanceTimersByTimeAsync(0);

    expect(restorePreviousPage).toHaveBeenCalledTimes(1);
    // 已还原 → 不再写错误页
    expect(showStatusPage).toHaveBeenCalledTimes(1);
  });

  it("writes the error page only when there was nothing to restore", async () => {
    useAppStore.setState({ rightPanelMode: "browser" });
    restorePreviousPage.mockResolvedValue("no-previous");
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);

    gate.resolve({ ok: false });
    await done;
    await vi.advanceTimersByTimeAsync(0);

    expect(showStatusPage).toHaveBeenLastCalledWith(
      "filePreview.officeRenderFailedRevealed",
      "error",
    );
  });

  it("leaves a page it never replaced alone", async () => {
    useAppStore.setState({ rightPanelMode: "browser" });
    // 热态失败：我们压根没写过等待页，主进程会说"当前是真实页面，别动"
    restorePreviousPage.mockResolvedValue("nothing-to-restore");
    render.mockResolvedValue({ ok: false });

    await openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(showStatusPage).not.toHaveBeenCalled();
  });

  it("cleans up after a superseded click whose waiting page is still on screen", async () => {
    // 评审复现的连点场景：A（慢）已经把等待页写进面板，B（快，失败）接手。
    // B 自己没有显示过等待页，但屏幕上那一个是 A 留下的——收尾必须由主进程判断，
    // 否则 A 的 spinner 会永久留在面板上。
    useAppStore.setState({ rightPanelMode: "browser" });
    restorePreviousPage.mockResolvedValue("restored");
    const slow = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValueOnce(slow.promise); // A：慢
    render.mockResolvedValueOnce({ ok: false }); // B：快且失败

    const first = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);
    expect(showStatusPage).toHaveBeenCalledTimes(1); // A 的等待页

    const second = openOfficePreview("/repo/b.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await second;
    await vi.advanceTimersByTimeAsync(0);

    // B 的收尾把 A 的等待页也清掉了
    expect(restorePreviousPage).toHaveBeenCalledTimes(1);

    slow.resolve({ ok: true, outPath: "/tmp/a.html" });
    await first;
  });

  it("does not write the waiting page when the render settles before the timer fires", async () => {
    // 早先那版定时器回调里 await getStatus，于是存在"回调跑到一半渲染完成"的竞态。
    // 现在回调体是同步的、且 finally 会 clearTimeout，这个交错在结构上不存在。
    // 这里守住那条用户可见的性质：快速渲染不写等待页。
    useAppStore.setState({ rightPanelMode: "browser" });
    render.mockResolvedValue({ ok: true, outPath: "/tmp/a.html" });

    await openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS * 2);

    expect(showStatusPage).not.toHaveBeenCalled();
  });

  it("tolerates a missing browser namespace", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { file: { renderOfficePreview: render } },
    });

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS + 1);

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await expect(done).resolves.toBeUndefined();
  });

  it("tolerates a missing showStatusPage IPC", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);
    getStatus.mockResolvedValue({ visible: false, url: "about:blank" });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { file: { renderOfficePreview: render }, browser: { getStatus } },
    });

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS + 1);

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await expect(done).resolves.toBeUndefined();
  });
});
