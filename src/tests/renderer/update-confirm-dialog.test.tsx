// @vitest-environment jsdom
//
// UpdateConfirmDialog 迁移后的不变量。
//
// 这个弹窗有两个容易在迁移中丢掉的细节：
//   1. 主面板**不能**冒泡到遮罩的关闭处理（原实现用 e.stopPropagation()）——
//      迁移后由 Radix 的 onInteractOutside 承担，语义必须一致
//   2. 安全注释里的决定：release notes 的 markdown 渲染必须屏蔽 img
//      （rehype-sanitize 默认 schema 允许远程图片，会把「打开弹窗」变成
//       向写 URL 的人发请求）—— 这是安全决定，不是样式决定，不可丢
//
// 查询作用域是 `document.body`：Radix 经 Portal 挂载（见 confirm-dialog.test.tsx）。
import "../../renderer/i18n/config";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { UpdateConfirmDialog } from "../../renderer/components/UpdateConfirmDialog";

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

const baseProps = {
  currentVersion: "1.0.50",
  newVersion: "1.0.51",
  onConfirm: () => {},
  onCancel: () => {},
};

describe("UpdateConfirmDialog", () => {
  it("occupies occlusion while open and releases when closed", async () => {
    await render(<UpdateConfirmDialog isOpen {...baseProps} />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await act(async () => {
      root.render(<UpdateConfirmDialog isOpen={false} {...baseProps} />);
    });
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("shows both versions", async () => {
    await render(<UpdateConfirmDialog isOpen {...baseProps} />);
    expect(document.body.textContent).toContain("1.0.50");
    expect(document.body.textContent).toContain("1.0.51");
  });

  it("omits the notes region entirely when there are no notes", async () => {
    await render(
      <UpdateConfirmDialog isOpen {...baseProps} releaseNotes={null} />,
    );
    expect(document.body.querySelector('[role="region"]')).toBeNull();
  });

  it("renders the notes region when notes exist", async () => {
    // releaseNotes 是发布流程写入的 **{zh, en} JSON 字符串**，不是 markdown 本身
    //（见 utils/release-notes.ts）。传裸 markdown 会 JSON.parse 失败、正确地落到
    // 「无 notes」分支 —— 这正是迁移前基线跑出的那条红，是测试输入错了。
    await render(
      <UpdateConfirmDialog
        isOpen
        {...baseProps}
        releaseNotes={JSON.stringify({ zh: "### 你好", en: "### hello" })}
      />,
    );
    expect(document.body.querySelector('[role="region"]')).not.toBeNull();
  });

  it("treats unreadable notes as no notes", async () => {
    // 契约：一切不可读的值都塌成 null，弹窗只有「有 notes / 无 notes」两态。
    await render(
      <UpdateConfirmDialog isOpen {...baseProps} releaseNotes="### hello" />,
    );
    expect(document.body.querySelector('[role="region"]')).toBeNull();
  });

  it("does not render remote images from release notes", async () => {
    // 安全决定：见本文件头注释。rehype-sanitize 的默认 schema 允许远程图片，
    // MARKDOWN_COMPONENTS 里的 img: () => null 才是真正的拦截点。
    const md = "![x](https://example.com/tracker.png)";
    await render(
      <UpdateConfirmDialog
        isOpen
        {...baseProps}
        releaseNotes={JSON.stringify({ zh: md, en: md })}
      />,
    );
    // 先确认 region 真的渲染了（否则下面的断言会因「什么都没渲染」而假绿）
    expect(document.body.querySelector('[role="region"]')).not.toBeNull();
    expect(document.body.querySelector("img")).toBeNull();
  });

  it("releases occlusion when Escape closes it", async () => {
    // 与 ConfirmDialog 同理：isOpen 是父级受控的，必须用带状态的 Harness。
    // 这条在迁移前预期是红的（旧实现没有键盘处理）。
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <UpdateConfirmDialog
          {...baseProps}
          isOpen={open}
          onCancel={() => setOpen(false)}
        />
      );
    }
    await render(<Harness />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });
});
