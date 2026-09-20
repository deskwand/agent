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

  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState(useAppStore.getInitialState());
    render = vi.fn();
    getStatus = vi.fn(async () => ({ visible: false, url: "about:blank" }));
    showStatusPage = vi.fn(async () => ({}));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        file: { renderOfficePreview: render },
        browser: { getStatus, showStatusPage },
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

  it("only toasts when the panel is open on a real page", async () => {
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

    expect(showStatusPage).not.toHaveBeenCalled();
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "filePreview.officePreviewLoading",
    );

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await done;
    // 成功后自己那条 toast 要被撤下
    expect(useAppStore.getState().globalNotice).toBeNull();
  });

  it("treats a failing getStatus as 'panel busy'", async () => {
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

    expect(showStatusPage).not.toHaveBeenCalled();
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "filePreview.officePreviewLoading",
    );

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await done;
  });

  it("replaces the waiting page with an error page when the panel is still open", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);
    const onFailure = vi.fn();

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure,
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);

    gate.resolve({ ok: false });
    await done;

    expect(showStatusPage).toHaveBeenLastCalledWith(
      "filePreview.officeRenderFailedRevealed",
      "error",
    );
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("does not write an error page when the panel was closed meanwhile", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);
    expect(showStatusPage).toHaveBeenCalledTimes(1);

    // 用户把面板关掉了
    useAppStore.setState({ rightPanelMode: null });
    gate.resolve({ ok: false });
    await done;

    // 只有第一次（等待页），没有错误页
    expect(showStatusPage).toHaveBeenCalledTimes(1);
  });

  it("keeps the tree/artifact busy path working", async () => {
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);
    expect(useAppStore.getState().officePreviewBusyPath).toBe("/repo/a.docx");

    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await done;
    expect(useAppStore.getState().officePreviewBusyPath).toBeNull();
  });

  it("does not strand the panel when the render finishes during the getStatus await", async () => {
    // 评审复现的竞态：门限到 → 定时器回调 park 在 getStatus 的 await 上 →
    // 渲染**在这期间**完成（navigate 已发出）→ 回调恢复执行。
    // 若不检查"已出结果"，等待页会在真预览之后写进去，面板就永久停在 spinner 上。
    //
    // 顺序很关键：渲染必须是**待定**的，否则主路径在 150ms 前就结束、finally 里会
    // clearTimeout，回调根本不触发（那就成了一场不存在的竞态的测试）。
    let releaseGetStatus: (v: {
      visible: boolean;
      url: string;
    }) => void = () => {};
    getStatus.mockImplementation(
      () =>
        new Promise<{ visible: boolean; url: string }>((resolve) => {
          releaseGetStatus = resolve;
        }),
    );
    const gate = deferred<{ ok: boolean; outPath?: string }>();
    render.mockReturnValue(gate.promise);
    const onSuccess = vi.fn();

    const done = openOfficePreview("/repo/a.docx", {
      t,
      onSuccess,
      onFailure: vi.fn(),
    });

    // 门限到 → 回调进入 getStatus 并停在那里
    await vi.advanceTimersByTimeAsync(OFFICE_PREVIEW_BUSY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();

    // 渲染就在这段 await 期间完成
    gate.resolve({ ok: true, outPath: "/tmp/a.html" });
    await vi.advanceTimersByTimeAsync(0);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // 放行 getStatus，并让被 park 住的回调真正恢复执行
    // （`await done` 在住路径完成时就返回，它不等这个回调）
    releaseGetStatus({ visible: false, url: "about:blank" });
    await vi.advanceTimersByTimeAsync(0);
    await done;

    // 真预览已在屏幕上，绝不能再写等待页去覆盖它
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
