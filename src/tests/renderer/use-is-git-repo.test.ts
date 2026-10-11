// @vitest-environment jsdom
//
// 探针的语义（null = 不知道 / 探测中，false = 问到了不是仓库）与缓存行为都是
// 「不渲染就没法验」的：用例一律挂一个只把返回值写进 data 属性的探针组件。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetIsGitRepoCacheForTests,
  useIsGitRepo,
} from "../../renderer/hooks/use-is-git-repo";

let container: HTMLDivElement;
let root: Root;

const renderLog: string[] = [];

function Probe({ cwd }: { cwd?: string }) {
  const value = useIsGitRepo(cwd);
  renderLog.push(String(value));
  return React.createElement("div", {
    "data-probe": String(value),
  });
}

function probeValue(): string | null {
  return (
    container.querySelector("[data-probe]")?.getAttribute("data-probe") ?? null
  );
}

async function render(cwd?: string): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Probe, { cwd }));
    await Promise.resolve();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** 一个可以手工兑现的 promise —— 用来停在「探测中」那一档上做断言。 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockHasChanges(
  impl: (cwd?: string) => Promise<{ isRepo: boolean; changeCount: number }>,
) {
  const hasChanges = vi.fn(impl);
  window.electronAPI = {
    git: { hasChanges },
  } as unknown as typeof window.electronAPI;
  return hasChanges;
}

beforeEach(() => {
  resetIsGitRepoCacheForTests();
  renderLog.length = 0;
  window.electronAPI = {} as unknown as typeof window.electronAPI;
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  resetIsGitRepoCacheForTests();
});

describe("useIsGitRepo", () => {
  it("没有 cwd：给 null，且一次 IPC 都不发", async () => {
    const hasChanges = mockHasChanges(async () => ({
      isRepo: true,
      changeCount: 0,
    }));

    await render(undefined);
    await flush();

    expect(probeValue()).toBe("null");
    expect(hasChanges).not.toHaveBeenCalled();
  });

  it("探测中给 null，结论回来后给 true", async () => {
    const gate = deferred<{ isRepo: boolean; changeCount: number }>();
    mockHasChanges(() => gate.promise);

    await render("/repo-probing");
    expect(probeValue()).toBe("null");

    gate.resolve({ isRepo: true, changeCount: 2 });
    await flush();
    expect(probeValue()).toBe("true");
  });

  it("是仓库：给 true；同一个 cwd 再挂载一次不再探（TTL 内命中缓存）", async () => {
    const hasChanges = mockHasChanges(async () => ({
      isRepo: true,
      changeCount: 1,
    }));

    await render("/repo-cached");
    await flush();
    expect(probeValue()).toBe("true");
    expect(hasChanges).toHaveBeenCalledTimes(1);

    // 换会话（组件卸载再挂载）回到同一个 cwd：不该再 spawn 一次
    await act(async () => root.unmount());
    root = createRoot(container);
    await render("/repo-cached");
    await flush();

    expect(probeValue()).toBe("true");
    expect(hasChanges).toHaveBeenCalledTimes(1);
  });

  it("TTL 过期后重探 —— 用户中途 git init 也能把按钮换回来", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const hasChanges = mockHasChanges(async () => ({
      isRepo: false,
      changeCount: 0,
    }));

    await render("/repo-then-init");
    await flush();
    expect(probeValue()).toBe("false");
    expect(hasChanges).toHaveBeenCalledTimes(1);

    // 超出 10s TTL，且这次主进程说它是仓库了
    now.mockReturnValue(1_000_000 + 10_001);
    hasChanges.mockImplementation(async () => ({
      isRepo: true,
      changeCount: 0,
    }));

    await act(async () => root.unmount());
    root = createRoot(container);
    await render("/repo-then-init");
    await flush();

    expect(probeValue()).toBe("true");
    expect(hasChanges).toHaveBeenCalledTimes(2);
  });

  it("同 cwd 的并发探针共享一次 IPC", async () => {
    const gate = deferred<{ isRepo: boolean; changeCount: number }>();
    const hasChanges = mockHasChanges(() => gate.promise);

    await act(async () => {
      root.render(
        React.createElement(
          "div",
          null,
          React.createElement(Probe, { cwd: "/repo-concurrent" }),
          React.createElement(Probe, { cwd: "/repo-concurrent" }),
        ),
      );
      await Promise.resolve();
    });

    expect(hasChanges).toHaveBeenCalledTimes(1);

    gate.resolve({ isRepo: true, changeCount: 0 });
    await flush();
    expect(
      [...container.querySelectorAll("[data-probe]")].map((n) =>
        n.getAttribute("data-probe"),
      ),
    ).toEqual(["true", "true"]);
  });

  it("挂载不动：窗口重新获得焦点时重探 —— 中途 git init 不必换会话", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    const hasChanges = mockHasChanges(async () => ({
      isRepo: false,
      changeCount: 0,
    }));

    await render("/repo-focus");
    await flush();
    expect(probeValue()).toBe("false");
    expect(hasChanges).toHaveBeenCalledTimes(1);

    // 用户去终端里 git init 完切回应用：焦点事件到了，而且**不等 TTL** 就重探 ——
    // 否则要再等 10s 才会自己回来。
    now.mockReturnValue(2_000_001);
    hasChanges.mockImplementation(async () => ({
      isRepo: true,
      changeCount: 0,
    }));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await flush();

    expect(probeValue()).toBe("true");
    expect(hasChanges).toHaveBeenCalledTimes(2);
  });

  it("已经是仓库时：焦点事件走 TTL，不白 spawn", async () => {
    const hasChanges = mockHasChanges(async () => ({
      isRepo: true,
      changeCount: 0,
    }));

    await render("/repo-focus-noop");
    await flush();
    expect(probeValue()).toBe("true");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await flush();

    expect(probeValue()).toBe("true");
    expect(hasChanges).toHaveBeenCalledTimes(1);
  });

  it("已探过的 cwd 再挂载：首帧就命中缓存（不接受中间那一帧 null）", async () => {
    mockHasChanges(async () => ({ isRepo: true, changeCount: 0 }));

    await render("/repo-first-frame");
    await flush();
    expect(probeValue()).toBe("true");

    await act(async () => root.unmount());
    root = createRoot(container);
    renderLog.length = 0;
    await render("/repo-first-frame");

    // 切回已探过的会话时按钮不该闪一下：第一帧就必须是 true（effect 要等 paint 之后才跑）
    expect(renderLog[0]).toBe("true");
  });

  it("IPC 抛错：给 false，不许崩、不许停在探测中", async () => {
    mockHasChanges(async () => {
      throw new Error("git not found");
    });

    await render("/repo-broken");
    await flush();

    expect(probeValue()).toBe("false");
  });

  it("没有 git 桥（浏览器模式）：给 false", async () => {
    window.electronAPI = {} as unknown as typeof window.electronAPI;

    await render("/repo-no-bridge");
    await flush();

    expect(probeValue()).toBe("false");
  });

  it("换 cwd：立刻回到 null，不把上一个目录的结论留在屏幕上", async () => {
    mockHasChanges(async () => ({ isRepo: true, changeCount: 0 }));

    await render("/repo-keep");
    await flush();
    expect(probeValue()).toBe("true");

    // 换成另一个还没探过的目录：第一帧必须是 null（调用方据此占位），
    // 绝不能先显示上一个目录的 true。
    const gate = deferred<{ isRepo: boolean; changeCount: number }>();
    (
      window.electronAPI.git.hasChanges as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => gate.promise);
    await act(async () => {
      root.render(React.createElement(Probe, { cwd: "/plain-other" }));
      await Promise.resolve();
    });
    expect(probeValue()).toBe("null");

    gate.resolve({ isRepo: false, changeCount: 0 });
    await flush();
    expect(probeValue()).toBe("false");
  });
});
