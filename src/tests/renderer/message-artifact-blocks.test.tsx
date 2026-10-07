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

const FENCE =
  '```artifact\n{"path":"/w/out/a.html","name":"a.html","render":"inline"}\n```';

function assistantMessage(text: string): Message {
  return {
    id: "a1",
    sessionId: "s1",
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: 100,
  };
}

describe("MessageCard 消息内产物块", () => {
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

  it("围栏变成产物行，位置在前后正文之间", () => {
    act(() => {
      root.render(
        <MessageCard
          message={assistantMessage(`前\n${FENCE}\n后`)}
          isLatestRound={false}
        />,
      );
    });
    const text = container.textContent ?? "";
    expect(text).toContain("前");
    expect(text).toContain("后");
    expect(text).not.toContain('"render":"inline"');
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(container.querySelector("iframe")).toBeNull();
    // 这条改动的**核心**就是位置：产物必须夹在前后文字之间，而不是飘到末尾。
    expect(text.indexOf("前")).toBeLessThan(text.indexOf("a.html"));
    expect(text.indexOf("a.html")).toBeLessThan(text.indexOf("后"));
  });

  it("最新一轮的产物自动展开", async () => {
    getRenderUrl.mockResolvedValue("deskwand-artifact://local/r/s/a.html");
    await act(async () => {
      root.render(
        <MessageCard message={assistantMessage(FENCE)} isLatestRound={true} />,
      );
      await Promise.resolve();
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("没有 render 标记的围栏从正文里消失，且不产生产物行", () => {
    const fence = '```artifact\n{"path":"/w/out/a.html"}\n```';
    act(() => {
      root.render(<MessageCard message={assistantMessage(`前${fence}后`)} />);
    });
    expect(container.textContent).toContain("前后");
    expect(container.textContent).not.toContain('"path"');
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });
});
