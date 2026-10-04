// @vitest-environment jsdom
/**
 * 确认键的语气：这个原语最早只服务「删除」，本次要拿它确认「下载 140MB」，
 * 不能顺手把既有调用点一起改成蓝色。
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

const buttons = () => [...container.querySelectorAll("button")];
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
});

const render = (tone?: "danger" | "primary") =>
  act(async () =>
    root.render(
      <ConfirmDialog
        isOpen
        title="标题"
        confirmLabel="确认"
        tone={tone}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ),
  );

describe("ConfirmDialog 的确认键语气", () => {
  it("不传 tone 时仍是 error 语气（守住既有调用点）", async () => {
    await render();

    expect(confirmButton().className).toContain("bg-error/10");
  });

  it("tone=primary 时换成 accent —— 「下载」不是危险操作", async () => {
    await render("primary");

    expect(confirmButton().className).toContain("bg-accent/10");
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
