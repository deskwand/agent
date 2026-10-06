// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { MessageCard } from "../../renderer/components/MessageCard";
import { useAppStore } from "../../renderer/store";
import type { Message } from "../../renderer/types";

const getRenderUrl = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => null),
);

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

const MESSAGE: Message = {
  id: "a1",
  sessionId: "s1",
  role: "assistant",
  content: [{ type: "text", text: "已生成" }],
  timestamp: 100,
};

describe("MessageCard inline artifacts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { window: Window }).window.electronAPI = {
      artifact: { getRenderUrl },
    } as unknown as typeof window.electronAPI;
    useAppStore.setState({ activeSessionId: "s1" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the folded row and no iframe for a non-latest turn", () => {
    act(() => {
      root.render(
        <MessageCard
          message={MESSAGE}
          isLatestRound={false}
          artifactFiles={[
            {
              path: "out/report.html",
              edits: 0,
              writes: 1,
              addedLines: 12,
              removedLines: 0,
            },
          ]}
          inlineArtifacts={[{ path: "out/report.html" }]}
        />,
      );
    });
    expect(container.textContent).toContain("report.html");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("mounts at most one iframe when several artifacts are present", async () => {
    getRenderUrl.mockResolvedValue("deskwand-artifact://local/r/s/out/a.html");
    await act(async () => {
      root.render(
        <MessageCard
          message={MESSAGE}
          isLatestRound={true}
          artifactFiles={[]}
          inlineArtifacts={[{ path: "out/a.html" }, { path: "out/b.html" }]}
        />,
      );
      await Promise.resolve();
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("keeps a manual collapse after the parent re-renders with a new array", async () => {
    getRenderUrl.mockResolvedValue("deskwand-artifact://local/r/s/out/a.html");
    const renderLatest = () =>
      root.render(
        <MessageCard
          message={MESSAGE}
          isLatestRound={true}
          artifactFiles={[]}
          // 新数组身份——模拟 ChatView 每次重算 Map 的情形
          inlineArtifacts={[{ path: "out/a.html" }]}
        />,
      );

    await act(async () => {
      renderLatest();
      await Promise.resolve();
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);

    // 折叠
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(container.querySelector("iframe")).toBeNull();

    // 父组件重渲染（trace step 更新会走这条路）——折叠必须保持
    await act(async () => {
      renderLatest();
      await Promise.resolve();
    });
    expect(container.querySelector("iframe")).toBeNull();
  });
});
