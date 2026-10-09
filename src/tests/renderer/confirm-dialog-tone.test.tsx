// @vitest-environment jsdom
/**
 * 确认键的语气：这个原语最早只服务「删除」，本次要拿它确认「下载 140MB」，
 * 不能顺手把既有调用点一起改成蓝色。
 *
 * 两处随迁移更新：
 *   - 查询作用域改 `document.body`：ConfirmDialog 迁到 Radix 的 AlertDialog 后，
 *     内容经 Portal 挂到 document.body，不再内联在 container 里
 *   - primary 语气的期望类名 `bg-accent/10` → `bg-primary/10`（设计文档 D7）。
 *     当前二者视觉完全相同（都指向品牌蓝 token），但计划 7 把 utility `accent`
 *     翻转成 hover 底色之后，`bg-accent/10` 会渲染成淡灰 —— 这个断言的本意是
 *     「用品牌色而非错误色」，跟随 D7 才能守住本意。
 *
 * 注意 mock 里必须提供 `initReactI18next`：i18n/config 会调
 * `i18n.use(initReactI18next)`，缺它会让初始化断掉，进而让读模块级 i18n 实例的
 * 工具（utils/i18n-format.ts）拿到 undefined。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ConfirmDialog } from "../../renderer/components/ConfirmDialog";
import { VoiceDownloadConfirm } from "../../renderer/components/VoiceDownloadConfirm";

let container: HTMLDivElement;
let root: Root;

const buttons = () => [...document.body.querySelectorAll("button")];
/** 取消在前、确认在后。 */
const confirmButton = () => buttons()[1];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (window as unknown as { electronAPI: unknown }).electronAPI = undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // Radix 经 Portal 挂到 document.body（见下方注释），清掉以免跨用例污染
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
});

const render = (
  tone?: "danger" | "primary",
  over: Partial<Parameters<typeof ConfirmDialog>[0]> = {},
) =>
  act(async () =>
    root.render(
      <ConfirmDialog
        isOpen
        title="标题"
        confirmLabel="确认"
        tone={tone}
        onConfirm={() => {}}
        onCancel={() => {}}
        {...over}
      />,
    ),
  );

describe("ConfirmDialog 的确认键语气", () => {
  it("不传 tone 时仍是 error 语气（守住既有调用点）", async () => {
    await render();

    expect(confirmButton().className).toContain("bg-error/10");
  });

  it("tone=primary 时换成品牌色 —— 「下载」不是危险操作", async () => {
    await render("primary");

    expect(confirmButton().className).toContain("bg-primary/10");
    expect(confirmButton().className).not.toContain("bg-error/10");
  });
});

describe("VoiceDownloadConfirm", () => {
  it("点「下载并开启」调 confirmDownload，点「取消」调 cancelDownload", async () => {
    const confirmDownload = vi.fn();
    const cancelDownload = vi.fn();
    await act(async () =>
      root.render(
        <VoiceDownloadConfirm
          engine={{
            install: null,
            ensureReady: async () => true,
            confirmOpen: true,
            confirmDownload,
            cancelDownload,
          }}
        />,
      ),
    );

    act(() => confirmButton().click());
    act(() => buttons()[0].click());

    expect(confirmDownload).toHaveBeenCalledTimes(1);
    expect(cancelDownload).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog 的 description 槽位", () => {
  it("不传 description 时不渲染任何描述节点（守住既有 11 个调用点）【Review Focus #1】", async () => {
    // description 必须是纯粹可选的 —— 不传时 DOM 与扩展前**逐字节相同**，
    // 否则 11 个既有调用点的外观会悄悄变。
    await render(undefined, {});
    expect(
      document.body.querySelector('[role="alertdialog"] p'),
      "不传 description 时不该出现描述段落",
    ).toBeNull();
  });

  it("description 渲染出来，默认是 muted 语气", async () => {
    await render(undefined, { description: "还有 2 个会话在跑" });
    const p = document.body.querySelector('[role="alertdialog"] p');
    expect(p?.textContent).toBe("还有 2 个会话在跑");
    // muted 时不传 className，让 vendored 的默认色生效
    expect(p?.className).not.toContain("text-error");
  });

  it("descriptionTone=error 时描述用 error 色", async () => {
    // 这是 Sidebar 删项目那条告警的要求（Review Focus #2）
    await render(undefined, {
      description: "还有 2 个会话在跑",
      descriptionTone: "error",
    });
    const p = document.body.querySelector('[role="alertdialog"] p');
    expect(p?.textContent).toBe("还有 2 个会话在跑");
    expect(p?.className).toContain("text-error");
  });
});
