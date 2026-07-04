// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import "../../renderer/i18n/config";
import { Sidebar } from "../../renderer/components/Sidebar";
import { useAppStore } from "../../renderer/store";
import type { MountedPath } from "../../renderer/types";

function makeSession(id: string, title: string) {
  return {
    id,
    title,
    status: "idle" as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [] as string[],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Sidebar current tasks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);

    useAppStore.setState({
      sessions: [
        makeSession("s1", "Active task"),
        makeSession("s2", "Inactive task"),
      ],
      activeSessionId: "s1",
      taskSlots: [
        { sessionId: "s1", completed: false },
        { sessionId: "s2", completed: false },
      ],
    });
  });

  it("reserves the left selection gutter for inactive current tasks", async () => {
    await act(async () => {
      root.render(React.createElement(Sidebar, { width: 280 }));
    });
    await flush();

    const activeTitle = Array.from(container.querySelectorAll("span")).find(
      (element) => element.textContent === "Active task",
    );
    const inactiveTitle = Array.from(container.querySelectorAll("span")).find(
      (element) => element.textContent === "Inactive task",
    );

    expect(activeTitle).toBeTruthy();
    expect(inactiveTitle).toBeTruthy();

    const activeItem = activeTitle?.parentElement?.parentElement;
    const inactiveItem = inactiveTitle?.parentElement?.parentElement;

    expect(activeItem?.className).toContain("border-l-[3px]");
    expect(activeItem?.className).toContain("border-l-accent");
    expect(inactiveItem?.className).toContain("border-l-[3px]");
    expect(inactiveItem?.className).toContain("border-l-transparent");
  });
});
