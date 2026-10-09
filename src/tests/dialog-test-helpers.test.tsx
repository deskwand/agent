// @vitest-environment jsdom
//
// 脚手架自己的用例。
//
// 为什么它需要有自测：这套助手里有两条**语义性**行为，错了会让所有用它的
// 弹窗测试一起静默失效 ——
//   1. builtinCloseButton() 必须取「最后一个」直接子 button，因为 DialogContent
//      的渲染顺序是 {children} 再 <DialogPrimitive.Close>
//   2. cleanupDialogs() 必须清 portal 节点，否则跨用例污染、且失败信息会误导
// 计划 2 已经吃过一次「测试空转」的亏（那条「外部点击不关闭」删掉实现照样通过），
// 所以助手也要有自己的用例。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDialogs, setupDialogTest } from "./dialog-test-helpers";

describe("dialog-test-helpers", () => {
  let d: ReturnType<typeof setupDialogTest>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    cleanupDialogs();
    d = setupDialogTest();
  });

  it("shell() 查 document.body 的 [role=dialog]", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "dialog");
    document.body.appendChild(el);
    expect(d.shell()).toBe(el);
    el.remove();
  });

  it("buttonByLabel 按文案精确匹配", async () => {
    await d.render(
      <div role="dialog">
        <button>取消</button>
        <button>确认</button>
      </div>,
    );
    expect(d.buttonByLabel("确认").textContent).toBe("确认");
  });

  it("buttonByLabel 找不到时抛错（不静默返回 undefined）", async () => {
    await d.render(
      <div role="dialog">
        <button>取消</button>
      </div>,
    );
    expect(() => d.buttonByLabel("不存在的键")).toThrow();
  });

  it("builtinCloseButton 取最后一个直接子 button，不是第一个", async () => {
    // 这条锁的是陷阱 3。把顺序写反会让「点内置关闭键」的用例点到提交键，
    // 而报错会指向「IPC 没被调用」，与真实原因差了十万八千里。
    await d.render(
      <div role="dialog">
        <div>
          <button>内部按钮（不是直接子节点）</button>
        </div>
        <button>提交</button>
        <button aria-label="内置关闭">X</button>
      </div>,
    );
    expect(d.builtinCloseButton().getAttribute("aria-label")).toBe("内置关闭");
  });

  it("shell(role) 能查菜单", async () => {
    await d.render(<div role="menu">菜单</div>);
    expect(d.shell("menu")).not.toBeNull();
    expect(d.shell(), "默认仍查 dialog").toBeNull();
  });

  it("cleanupDialogs 也清菜单（否则跨用例污染）", async () => {
    await d.render(<div role="menu">菜单</div>);
    cleanupDialogs();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("teardown 清掉 portal 节点（否则跨用例污染）", async () => {
    await d.render(
      <div role="dialog">
        <button>取消</button>
      </div>,
    );
    expect(d.shell()).not.toBeNull();
    d.teardown();
    expect(d.shell()).toBeNull();
  });
});
