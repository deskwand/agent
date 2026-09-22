// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  ChatInput,
  type ChatInputHandle,
  type ChatInputSubmitData,
} from "../../renderer/components/ChatInput";
import { serializeEditor } from "../../renderer/utils/editor-content";
import {
  draftStorageKey,
  readDraft,
  writeDraft,
  type ChatDraft,
} from "../../renderer/utils/chat-draft-store";
import type { ElementSelection } from "../../shared/ipc-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

let container: HTMLDivElement;
let root: Root;
let inputRef: React.RefObject<ChatInputHandle>;
let onSubmit: Mock<(data: ChatInputSubmitData) => void>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  inputRef = React.createRef<ChatInputHandle>();
  onSubmit = vi.fn<(data: ChatInputSubmitData) => void>();
  // jsdom 定义了 document.execCommand 但一调用就抛 "Not implemented"。
  document.execCommand = vi.fn(
    () => true,
  ) as unknown as typeof document.execCommand;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // 卸载 flush 会往 localStorage 写一次；清掉，避免污染下一个用例。
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function renderInput(draftKey: string) {
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        ref: inputRef,
        onSubmit,
        draftKey,
        placeholder: "写点什么",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
      }),
    );
  });
}

function editorEl(): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-placeholder]");
  if (!el) throw new Error("找不到编辑器元素");
  return el;
}

async function typeText(text: string) {
  const el = editorEl();
  await act(async () => {
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * 只 fake setTimeout/clearTimeout：React 的调度器在 jsdom 里走 MessageChannel，
 * 连 Date / queueMicrotask 一起 fake 会让 act 挂死。
 */
function useDebounceTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

async function advanceDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
}

describe("ChatInput 逐会话草稿", () => {
  it("切换会话时输入框不共享：A 的内容不会出现在 B", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("会话A的草稿");
    await advanceDebounce();

    await renderInput("sess-b");
    expect(serializeEditor(editorEl())).toBe("");
  });

  it("切回会话时草稿回来", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("会话A的草稿");
    await advanceDebounce();

    await renderInput("sess-b");
    await renderInput("sess-a");

    expect(serializeEditor(editorEl())).toBe("会话A的草稿");
  });

  it("写入发生在 debounce 之后，不是每次按键", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("半句话");

    expect(localStorage.getItem(draftStorageKey("sess-a"))).toBeNull();

    await advanceDebounce();
    expect(readDraft("sess-a")?.text).toBe("半句话");
  });

  it("清空后切走，槽位里不能留旧草稿（防复活）", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("删掉我");
    await advanceDebounce();
    expect(readDraft("sess-a")).not.toBeNull();

    await typeText("");
    await advanceDebounce();
    await renderInput("sess-b");

    expect(localStorage.getItem(draftStorageKey("sess-a"))).toBeNull();
  });

  it("clear() 立即删掉本槽位草稿，不等 debounce", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("发出去就不该留下");
    await advanceDebounce();

    await act(async () => {
      inputRef.current?.clear();
    });

    expect(localStorage.getItem(draftStorageKey("sess-a"))).toBeNull();
  });

  it("卸载时把待写的快照落盘，不等 debounce（退出应用前不丢字）", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("还没到 debounce 就退出");

    // 不推进定时器，直接卸载
    await act(async () => {
      root.unmount();
    });

    expect(readDraft("sess-a")?.text).toBe("还没到 debounce 就退出");
  });

  it("clear(旧槽位) 在用户已经切走后：不碰新会话的编辑器与草稿，只清旧槽位", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("A 发出去的内容");
    await advanceDebounce();

    await renderInput("sess-b");
    await typeText("B 正在写");
    await advanceDebounce();

    // 模拟这条时序：A 的发送晚回来，而用户已经在 B 里打字
    await act(async () => {
      inputRef.current?.clear("sess-a");
    });

    expect(localStorage.getItem(draftStorageKey("sess-a"))).toBeNull();
    expect(serializeEditor(editorEl())).toBe("B 正在写");
    expect(readDraft("sess-b")?.text).toBe("B 正在写");
  });

  it("挂载时恢复本槽位草稿", async () => {
    useDebounceTimers();
    await renderInput("sess-a");
    await typeText("先写一半");
    await advanceDebounce();

    // 模拟重启：卸载后用同一个 draftKey 重新挂载
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderInput("sess-a");

    expect(serializeEditor(editorEl())).toBe("先写一半");
  });

  const elementFixture: ElementSelection = {
    pageUrl: "http://fixture/",
    pageTitle: "Fixture",
    tag: "button",
    classes: ["primary"],
    text: "开始使用",
    outerHTML: '<button class="primary">开始使用</button>',
    role: "button",
    accessibleName: "开始使用",
    selector: "button.primary",
    selectorUnique: true,
    domPath: "body > button:nth-child(1)",
    matchedCss: [],
    computed: {},
    rect: { x: 0, y: 0, width: 120, height: 40 },
    parent: null,
    siblings: [],
    viewport: { width: 1280, height: 800, dpr: 2 },
    scroll: { x: 0, y: 0 },
  };

  it("挂载时恢复图片（用 data URL 重建缩略图）", async () => {
    useDebounceTimers();
    const seeded: ChatDraft = {
      v: 1,
      text: "看图",
      images: [{ base64: "iVBORw0KGgo=", mediaType: "image/png" }],
      files: [],
      elSelections: [],
    };
    writeDraft("sess-a", seeded);

    await renderInput("sess-a");

    const imgs = container.querySelectorAll<HTMLImageElement>(
      'img[src^="data:image/png;base64,"]',
    );
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  it("挂载时恢复附件与元素拾取磁贴", async () => {
    useDebounceTimers();
    const seeded: ChatDraft = {
      v: 1,
      text: "",
      images: [],
      files: [
        {
          name: "报表.xlsx",
          path: "/tmp/报表.xlsx",
          size: 12,
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          source: "local",
        },
      ],
      elSelections: [elementFixture],
    };
    writeDraft("sess-b", seeded);

    await renderInput("sess-b");

    expect(container.textContent).toContain("报表.xlsx");
    expect(container.textContent).toContain("button.primary");
    expect(container.textContent).toContain("开始使用");
  });

  it("切走再切回：图片 / 附件 / 元素拾取原样还在", async () => {
    useDebounceTimers();
    const seeded: ChatDraft = {
      v: 1,
      text: "带附件",
      images: [{ base64: "iVBORw0KGgo=", mediaType: "image/png" }],
      files: [
        {
          name: "报表.xlsx",
          path: "/tmp/报表.xlsx",
          size: 12,
          type: "application/vnd.ms-excel",
          source: "local",
        },
      ],
      elSelections: [elementFixture],
    };
    writeDraft("sess-a", seeded);

    await renderInput("sess-a");
    await renderInput("sess-b");
    await renderInput("sess-a");

    const stored = readDraft("sess-a");
    expect(stored?.images).toEqual(seeded.images);
    expect(stored?.files).toEqual(seeded.files);
    expect(stored?.elSelections).toEqual(seeded.elSelections);
    expect(container.querySelectorAll('img[src^="data:image/"]')).toHaveLength(
      1,
    );
  });

  it("B 会话是干净的：A 的图片与附件不会跟过去", async () => {
    useDebounceTimers();
    writeDraft("sess-a", {
      v: 1,
      text: "",
      images: [{ base64: "iVBORw0KGgo=", mediaType: "image/png" }],
      files: [
        {
          name: "报表.xlsx",
          path: "/tmp/报表.xlsx",
          size: 12,
          type: "application/vnd.ms-excel",
          source: "local",
        },
      ],
      elSelections: [elementFixture],
    });

    await renderInput("sess-a");
    await renderInput("sess-b");

    expect(container.querySelectorAll('img[src^="data:image/"]')).toHaveLength(
      0,
    );
    expect(container.textContent).not.toContain("报表.xlsx");
    expect(container.textContent).not.toContain("开始使用");
  });
});
