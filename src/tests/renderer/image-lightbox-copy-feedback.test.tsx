// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ImageLightbox } from "../../renderer/components/ImageLightbox";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IMAGE_SRC = "data:image/png;base64,aGVsbG8=";

/**
 * 组件先写 `img.src`、后挂 `img.onload`。setter 必须异步触发 onload，
 * 同步触发会让那个 Promise 永不 resolve，handleCopy 卡在第一步。
 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 10;
  naturalHeight = 10;
  crossOrigin: string | null = null;
  private loaded = "";

  get src(): string {
    return this.loaded;
  }

  set src(value: string) {
    this.loaded = value;
    queueMicrotask(() => this.onload?.());
  }
}

/**
 * jsdom 没有实现 ClipboardItem。缺了它 `new ClipboardItem(...)` 抛 ReferenceError，
 * handleCopy 会走 catch 回退到 writeText，而回退路径同样会点亮 copyFeedback ——
 * 测试会因为错误的路径变绿。所以这个 stub 不能省。
 */
class FakeClipboardItem {
  constructor(readonly data: Record<string, Blob>) {}
}

let container: HTMLDivElement;
let root: Root;
let clipboardWrite: ReturnType<typeof vi.fn>;
let clipboardWriteText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.setItem("i18nextLng", "en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  clipboardWrite = vi.fn().mockResolvedValue(undefined);
  clipboardWriteText = vi.fn().mockResolvedValue(undefined);

  (globalThis as { Image?: unknown }).Image = FakeImage;
  (globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: clipboardWrite, writeText: clipboardWriteText },
  });
  // 这两个是直接赋到原型上的，`restoreMocks` / `mockReset` 管不到（它们只管
  // `vi.spyOn`）。当下不是泄漏：vitest 默认 `isolate: true`，每个测试文件一个全新
  // 环境，而且全仓只有这个文件碰 canvas。安全网是隔离，不是这里的还原 ——
  // 哪天谁开了 `--no-isolate`，要改回 `vi.spyOn`。
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as never;
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => {
    cb(new Blob(["png"], { type: "image/png" }));
  }) as never;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

async function renderLightbox() {
  await act(async () => {
    root.render(
      React.createElement(ImageLightbox, {
        isOpen: true,
        images: [{ src: IMAGE_SRC, name: "shot.png" }],
        onClose: () => {},
      }),
    );
  });
}

function copyButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Copy"]',
  );
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

describe("image lightbox copy feedback", () => {
  it("swaps the icon to Check and keeps the label after a successful copy", async () => {
    await renderLightbox();
    const button = copyButton();
    expect(button.querySelector(".lucide-copy")).not.toBeNull();
    expect(button.textContent).toBe("Copy");

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // 不等固定次数的微任务：那等于把 handleCopy 里 await 的个数写进测试，
      // 以后往 handleCopy 里多一个 await，这里就会因为与本次改动无关的原因挂掉。
      // 轮询到剪贴板被写为止。
      await vi.waitFor(() => {
        expect(clipboardWrite).toHaveBeenCalledTimes(1);
      });
    });

    // 断言 3：证明走的是图片剪贴板路径，而不是 catch 里的 writeText 回退。
    // 没有这一条，断言 1 和 2 在错误的回退路径下也会通过。
    // 先查调用次数、再读 mock.calls —— 顺序反了的话，回退路径下这里抛的是
    // TypeError: Cannot read properties of undefined (reading '0')，
    // 而不是「write 根本没被调过」这条能直接指出病因的断言。
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(clipboardWriteText).not.toHaveBeenCalled();
    const items = clipboardWrite.mock.calls[0][0] as Array<{
      data: Record<string, Blob>;
    }>;
    expect(Object.keys(items[0].data)).toEqual(["image/png"]);

    // 断言 1：图标换成对勾，且带语义色 token。
    // lucide 把调用方的 className 拼在自身类名后面，实测得到
    // "lucide lucide-check w-4 h-4 text-success"，所以复合选择器可用。
    // 少了 .text-success 这一半，把颜色删掉测试照样绿。
    expect(button.querySelector(".lucide-check.text-success")).not.toBeNull();
    expect(button.querySelector(".lucide-copy")).toBeNull();

    // 断言 2：文字标签不变（改动前这里是 "Copied"）。
    expect(button.textContent).toBe("Copy");
  });
});
