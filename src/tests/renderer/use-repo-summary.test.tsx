// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetRepoSummaryCacheForTests,
  useRepoSummary,
} from "../../renderer/hooks/use-repo-summary";
import type { RepoSummary } from "../../shared/repo-summary";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function summary(branch: string): RepoSummary {
  return {
    isRepo: true,
    branch,
    additions: 1,
    deletions: 2,
    changedFiles: 3,
    untracked: 0,
  };
}

function Probe({
  cwd,
  visible,
  refetchKey,
}: {
  cwd: string;
  visible: boolean;
  refetchKey?: string | number;
}) {
  const result = useRepoSummary(cwd, { visible, refetchKey });
  return (
    <div data-testid="out">
      {result.isLoading
        ? "loading"
        : result.error
          ? `error:${result.error}`
          : (result.summary?.branch ?? "none")}
    </div>
  );
}

function output(container: HTMLDivElement): string {
  return container.textContent ?? "";
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetRepoSummaryCacheForTests();
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

function mockApi(
  impl: (cwd: string) => Promise<RepoSummary>,
): ReturnType<typeof vi.fn> {
  const getRepoSummary = vi.fn(impl);
  window.electronAPI = {
    git: { getRepoSummary },
  } as unknown as typeof window.electronAPI;
  return getRepoSummary;
}

describe("useRepoSummary", () => {
  it("does not call the bridge while the panel is hidden", async () => {
    const getRepoSummary = mockApi(async () => summary("main"));

    act(() => {
      root.render(<Probe cwd="/repo" visible={false} />);
    });
    await flush();

    expect(getRepoSummary).not.toHaveBeenCalled();
  });

  it("fetches once visible and renders the branch", async () => {
    const getRepoSummary = mockApi(async () => summary("feature/x"));

    act(() => {
      root.render(<Probe cwd="/repo" visible />);
    });
    await flush();

    expect(getRepoSummary).toHaveBeenCalledTimes(1);
    expect(output(container)).toBe("feature/x");
  });

  it("reuses the cached summary inside the TTL window", async () => {
    const getRepoSummary = mockApi(async () => summary("main"));

    act(() => {
      root.render(<Probe cwd="/repo" visible />);
    });
    await flush();
    await act(async () => root.render(<Probe cwd="/repo" visible={false} />));
    await act(async () => root.render(<Probe cwd="/repo" visible />));
    await flush();

    expect(getRepoSummary).toHaveBeenCalledTimes(1);
  });

  it("refetches when the refetch key changes", async () => {
    const getRepoSummary = mockApi(async () => summary("main"));

    act(() => {
      root.render(<Probe cwd="/repo" visible refetchKey="idle" />);
    });
    await flush();
    await act(async () =>
      root.render(<Probe cwd="/repo" visible refetchKey="running" />),
    );
    await flush();

    expect(getRepoSummary).toHaveBeenCalledTimes(2);
  });

  it("retries after a bridge failure instead of caching the rejection", async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;

    act(() => {
      root.render(<Probe cwd="/repo" visible refetchKey="first" />);
    });
    await flush();
    expect(output(container)).toBe("error:git bridge unavailable");

    mockApi(async () => summary("main"));
    await act(async () =>
      root.render(<Probe cwd="/repo" visible refetchKey="second" />),
    );
    await flush();

    expect(output(container)).toBe("main");
  });

  it("drops a stale response when the cwd changes", async () => {
    const first = deferred<RepoSummary>();
    const second = deferred<RepoSummary>();
    mockApi((cwd) => (cwd === "/repo-a" ? first.promise : second.promise));

    act(() => {
      root.render(<Probe cwd="/repo-a" visible />);
    });
    await flush();

    await act(async () => root.render(<Probe cwd="/repo-b" visible />));
    await flush();

    await act(async () => {
      second.resolve(summary("branch-b"));
    });
    await flush();
    await act(async () => {
      first.resolve(summary("branch-a"));
    });
    await flush();

    expect(output(container)).toBe("branch-b");
  });

  it("surfaces bridge failures as an error state", async () => {
    mockApi(async () => {
      throw new Error("git missing");
    });

    act(() => {
      root.render(<Probe cwd="/repo" visible />);
    });
    await flush();

    expect(output(container)).toBe("error:git missing");
  });
});

it("shares an in-flight cwd request between two visible panes", async () => {
  const pending = deferred<RepoSummary>();
  const getRepoSummary = mockApi(() => pending.promise);
  await act(async () =>
    root.render(
      <>
        <Probe cwd="/shared" visible />
        <Probe cwd="/shared" visible />
      </>,
    ),
  );
  await flush();
  expect(getRepoSummary).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(summary("shared-branch")));
  await flush();
  expect(
    [...container.querySelectorAll('[data-testid="out"]')].map(
      (node) => node.textContent,
    ),
  ).toEqual(["shared-branch", "shared-branch"]);
  await act(async () => window.dispatchEvent(new Event("focus")));
  await flush();
  expect(getRepoSummary).toHaveBeenCalledTimes(1);
});
