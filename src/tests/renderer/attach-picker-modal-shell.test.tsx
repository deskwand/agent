// @vitest-environment jsdom
//
// AttachPickerModal 的外壳不变量。
//
// 三条来自原实现的注释、迁移后必须仍成立：
//   1. 外部点击**不关闭**弹窗（原来在 onMouseDown 里 preventDefault；
//      理由是点遮罩不该把焦点从搜索框抢走）。迁移后改由 onInteractOutside 抑制 ——
//      注意这是**我们自己的代码**（不是 Radix 默认），所以下面那条用例
//      真的在测我们的实现。
//   2. Esc 关闭（原来绑在 document 上，因为点遮罩后焦点离开弹窗、
//      绑在元素上的 keydown 收不到 —— Radix 自己就是绑 document 的）
//   3. 标题与 aria-label 走 i18n
// 另外它原本就手工 createPortal 到 body；迁到 Radix 后由 Radix 的 portal 承担。
//
// 用 Dialog 而不是 AlertDialog：picker 不是「必须应答」的紧急场景，
// 用 AlertDialog 会拿到 role="alertdialog"，读屏会按紧急角色播报一个文件选择器。
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { AttachPickerModal } from "../../renderer/components/attach/AttachPickerModal";
import { AttachPickerPanel } from "../../renderer/components/attach/AttachPickerPanel";

const onClose = vi.fn();
const onConfirm = vi.fn();

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function mount(selectedCount = 2, children: ReactNode = <div>panel</div>) {
  return render(
    <AttachPickerModal
      source="vault"
      subtitle="3 个文件"
      selectedCount={selectedCount}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      {children}
    </AttachPickerModal>,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onClose.mockClear();
  onConfirm.mockClear();
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

const shell = (): Element | null =>
  document.body.querySelector('[role="dialog"]');

describe("AttachPickerModal 外壳", () => {
  it("常驻占用 occlusion，卸载时释放", async () => {
    await mount();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    await act(async () => {
      root.render(<div />);
    });
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("内容经 portal 渲染到 body（不在 container 里）", async () => {
    await mount();
    expect(shell()).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Esc 关闭", async () => {
    await mount();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("外部点击不关闭弹窗", async () => {
    // 这条测的是**我们自己的** onInteractOutside 抑制，不是 Radix 默认行为
    //（Dialog 默认会关闭遮罩点击）。
    //
    // 派发到 `container` 而不是 `document.body`：container 是本用例创建的一个
    // 真在弹窗外面的元素（弹窗经 portal 挂到 body 下、与 container 平级）。
    // 事件从 container 冒泡到 document，Radix 的 DismissableLayer（就听在 document 上）
    // 会判定「点在内容之外」并尝试关闭 —— 这正是要验证被我们拦住的那条路径。
    // （派发到 body 则太弱：body 的 target 不会命中任何遮罩处理。）
    await mount();
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      container.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      // ⚠️ `click` 不能省：Radix 的 DialogContent 传了
      // `deferPointerDownOutside: true`，对主键 pointerdown 它会把「外部关闭」
      // 推迟到 **click** 事件。只派发 pointerdown/mousedown 的话根本不会触发
      // 关闭尝试 —— 这条用例会变成空转：实测把 onInteractOutside 整个删掉，
      // 它照样通过。
      container.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose, "遮罩/外部点击不得关闭").not.toHaveBeenCalled();
    expect(shell()).not.toBeNull();
  });

  it("标题与 aria-label 走 i18n（不是硬编码英文）", async () => {
    await mount();
    const label = shell()?.getAttribute("aria-label");
    expect(label, "aria-label 必须存在").toBeTruthy();
    // 与 i18n 实例比对，不抄文案、也不断言 key：
    // 抄文案会在改翻译时假红；而断言 key 会直接红（本测试导入的是真 i18n，
    // t() 返回的是真文案，不是 key）。
    expect(label).toBe(i18n.t("attachMenu.vault"));
  });

  it("两段式 Esc：焦点在面板里时，第一次只清搜索、不关闭；第二次才关", async () => {
    // ⚠️ 这条必须挂**真的** AttachPickerPanel。既有的
    // attach-picker-panel.test.ts 是孤立挂载面板的，看不到 Radix 的干扰：
    // Radix 的 Esc 监听挂在 document 的**捕获阶段**，会先于弹窗内任何 React
    // 处理器跑完并关掉弹窗 —— 于是第一次 Esc 直接把选择器关了，
    // 面板那套「先清搜索、再关闭」的两段语义被吃掉。
    //
    // 这是真实回归（原实现的 document 监听在冒泡阶段，面板的
    // stopPropagation() 能拦住它）。
    const onClose = vi.fn();
    // AttachPickerItem 的真实形状：{ id, name, label, size }。
    // label 是搜索匹配用的完整展示串，漏了它 filterPickerItems 会在
    // item.label.toLowerCase() 上抛异常、把整棵树带崩（初稿就踩了这个，
    // 表现为「弹窗消失了」—— 看着像 Esc 回归，其实是测试数据错）。
    const items = [
      { id: "alpha.pdf", name: "alpha.pdf", label: "alpha.pdf", size: 10 },
      { id: "beta.csv", name: "beta.csv", label: "beta.csv", size: 20 },
    ];
    await render(
      <AttachPickerModal
        source="vault"
        subtitle="2 个文件"
        selectedCount={0}
        onClose={onClose}
        onConfirm={() => {}}
      >
        <AttachPickerPanel
          source="vault"
          items={items}
          loading={false}
          emptyLabel="空"
          onRetry={() => {}}
          addedKeys={new Set<string>()}
          selectedIds={[]}
          onSelectionChange={() => {}}
          onClose={onClose}
          onConfirm={() => {}}
        />
      </AttachPickerModal>,
    );

    // aria-label 是**译文**（组件里写的是 t("attachPicker.searchPlaceholder")），
    // 所以用 i18n 实例算出来再拼选择器，不写死文案。
    const search = document.body.querySelector<HTMLInputElement>(
      `input[aria-label="${i18n.t("attachPicker.searchPlaceholder")}"]`,
    );
    expect(search, "搜索框必须存在").not.toBeNull();
    await act(async () => {
      // 必须走 native setter：React 的 _valueTracker 会跟踪直接赋值，
      // 导致 input 事件被认为是「值没变」而静默抑制 onChange
      //（同一个坑在 Task 2 的 sudo 测试里踩过）。
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(search, "beta");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 第一次 Esc：只清搜索。
    // ⚠️ `cancelable: true` 是必须的：弹窗靠 `onEscapeKeyDown` 里
    // `preventDefault()` 阻止 Radix 自己关闭，而非 cancelable 的事件上
    // preventDefault 是空操作、defaultPrevented 永远为 false
    //（真实浏览器的 keydown 是可取消的，是测试里要显式声明）。
    await act(async () => {
      search!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClose, "第一次 Esc 不得关闭弹窗").not.toHaveBeenCalled();
    expect(shell(), "弹窗必须还在").not.toBeNull();

    // 第二次 Esc：关闭（恰好一次）
    await act(async () => {
      search!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClose, "第二次 Esc 应当关闭").toHaveBeenCalledTimes(1);
  });

  it("底部计数随 selectedCount 变化，为 0 时禁用添加", async () => {
    await mount(0);
    const text = document.body.textContent ?? "";
    expect(text).toContain(i18n.t("attachPicker.selectedNone"));
    const addButton = Array.from(document.body.querySelectorAll("button")).find(
      (b) =>
        b.textContent?.includes(i18n.t("attachPicker.addCount", { count: 0 })),
    );
    expect(addButton, "添加按钮必须存在").toBeTruthy();
    expect(addButton?.disabled).toBe(true);
  });
});
