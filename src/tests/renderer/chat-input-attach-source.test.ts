// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInput,
  type ChatInputAttachedFile,
  type ChatInputHandle,
} from "../../renderer/components/ChatInput";
import { attachmentKeySet } from "../../renderer/utils/attached-files";

const tMock = vi.hoisted(() => vi.fn((key: string) => key));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tMock }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));

const vaultFile: ChatInputAttachedFile = {
  name: "secret.pdf",
  path: "/home/me/.deskwand/vault/secret.pdf",
  size: 10,
  type: "application/octet-stream",
  source: "vault",
  dedupeId: "secret.pdf",
};

let container: HTMLDivElement;
let root: Root;
let ref: React.RefObject<ChatInputHandle>;

beforeEach(() => {
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  ref = React.createRef<ChatInputHandle>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function renderInput(
  onAttachmentsChange?: (files: ChatInputAttachedFile[]) => void,
) {
  act(() => {
    root.render(
      React.createElement(ChatInput, {
        draftKey: "test-session",
        ref,
        onSubmit: () => {},
        placeholder: "p",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
        onAttachmentsChange,
      }),
    );
  });
}

describe("ChatInput attachments", () => {
  it("adds files through the handle and renders them as chips", () => {
    renderInput();
    act(() => ref.current?.addFiles([vaultFile]));
    expect(container.textContent).toContain("secret.pdf");
  });

  it("shows the vault source hint on a vault chip", () => {
    renderInput();
    act(() => ref.current?.addFiles([vaultFile]));

    expect(tMock).toHaveBeenCalledWith("attachChip.vaultSource", {
      name: "secret.pdf",
    });
  });

  it("shows the full path hint on a non-vault attachment tile", () => {
    renderInput();
    act(() =>
      ref.current?.addFiles([
        {
          name: "notes.md",
          path: "/repo/docs/notes.md",
          size: 3,
          type: "application/octet-stream",
        },
      ]),
    );

    // 磁贴把路径放进 title 属性（原来是渲染在隐藏的 tooltip span 里）
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe(
      "/repo/docs/notes.md",
    );
  });

  it("ignores a duplicate injection", () => {
    const onAttachmentsChange = vi.fn();
    renderInput(onAttachmentsChange);
    const file: ChatInputAttachedFile = {
      name: "a.txt",
      path: "/repo/a.txt",
      size: 1,
      type: "application/octet-stream",
      source: "workspace",
      dedupeId: "a.txt",
    };
    act(() => ref.current?.addFiles([file]));
    act(() => ref.current?.addFiles([file]));

    const calls = onAttachmentsChange.mock.calls;
    expect(calls[calls.length - 1][0]).toHaveLength(1);
  });

  it("reports the current attachment list for the picker's added marking", () => {
    const onAttachmentsChange = vi.fn();
    renderInput(onAttachmentsChange);
    act(() => ref.current?.addFiles([vaultFile]));
    expect(onAttachmentsChange).toHaveBeenCalledWith([vaultFile]);
  });

  it("keeps selectFiles available for the local file entry", () => {
    renderInput();
    expect(typeof ref.current?.selectFiles).toBe("function");
  });

  it("does not loop when the host passes an unstable attachments callback", () => {
    // 回归：宿主若直接传内联箭头函数（每次渲染新引用），effect 会反复触发。
    // 安全网是 attachmentKeySet 在内容未变时返回 prev，让 React bail out。
    // 加超时：这条一旦回退成死循环，是“挂死”而不是“断言失败”，超时才能给出信号。
    let renders = 0;
    function Harness() {
      const [, setKeys] = useState<ReadonlySet<string>>(
        () => new Set<string>(),
      );
      renders += 1;
      return React.createElement(ChatInput, {
        draftKey: "test-session",
        onSubmit: () => {},
        placeholder: "p",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
        onAttachmentsChange: (files: ChatInputAttachedFile[]) =>
          setKeys((prev) => attachmentKeySet(files, prev)),
      });
    }

    act(() => {
      root.render(React.createElement(Harness));
    });
    act(() => {
      root.render(React.createElement(Harness));
    });

    expect(renders).toBeLessThanOrEqual(3);
  }, 3000);
});
