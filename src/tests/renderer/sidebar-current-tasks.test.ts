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

  it("sorts running tasks before completed tasks and by updatedAt desc", async () => {
    const base = Date.now();
    useAppStore.setState({
      sessions: [
        {
          ...makeSession("s_old_run", "Old running"),
          id: "s_old_run",
          updatedAt: base - 2000,
        },
        {
          ...makeSession("s_new_run", "New running"),
          id: "s_new_run",
          updatedAt: base,
        },
        {
          ...makeSession("s_old_done", "Old done"),
          id: "s_old_done",
          updatedAt: base - 4000,
        },
        {
          ...makeSession("s_new_done", "New done"),
          id: "s_new_done",
          updatedAt: base - 1000,
        },
      ],
      taskSlots: [
        { sessionId: "s_old_done", completed: true },
        { sessionId: "s_new_done", completed: true },
        { sessionId: "s_new_run", completed: false },
        { sessionId: "s_old_run", completed: false },
      ],
    });

    await act(async () => {
      root.render(React.createElement(Sidebar, { width: 280 }));
    });
    await flush();

    const taskSection = container.querySelector(".max-h-40");
    expect(taskSection).toBeTruthy();
    const children = taskSection!.children;
    const titles = Array.from(children).map((c) => c.textContent?.trim() ?? "");

    // running first: newest → oldest, then completed: newest → oldest
    expect(titles).toEqual([
      "New running",
      "Old running",
      "New done",
      "Old done",
    ]);
  });

  it("pushes slots with missing sessions to the end", async () => {
    const base = Date.now();
    useAppStore.setState({
      sessions: [
        {
          ...makeSession("s_real", "Real session"),
          id: "s_real",
          updatedAt: base,
        },
      ],
      taskSlots: [
        { sessionId: "s_orphan", completed: false },
        { sessionId: "s_real", completed: false },
      ],
    });

    await act(async () => {
      root.render(React.createElement(Sidebar, { width: 280 }));
    });
    await flush();

    const taskSection = container.querySelector(".max-h-40");
    expect(taskSection).toBeTruthy();
    const children = taskSection!.children;
    const titles = Array.from(children).map((c) => c.textContent?.trim() ?? "");

    // orphan slot with missing session should be hidden (returns null), so only Real session renders
    expect(titles).toEqual(["Real session"]);
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
