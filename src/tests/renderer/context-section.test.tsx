// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

import { ContextSection } from "../../renderer/components/overview/ContextSection";
import {
  CONTEXT_BREAKDOWN_LABEL_KEYS,
  DOT_CLASS,
  SEGMENT_CLASS,
} from "../../renderer/components/overview/context-breakdown-style";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";
import { useAppStore } from "../../renderer/store";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const userMessage = (chars: number) => ({
  id: "m1",
  sessionId: "s1",
  role: "user" as const,
  timestamp: 1,
  content: [{ type: "text" as const, text: "a".repeat(chars) }],
});

/** findLastPromptInputTokens 只认消息上的 tokenUsage，这里补一条只带用量的消息。 */
function withUsage(totalPromptInput: number) {
  return [
    userMessage(400),
    {
      id: "usage",
      sessionId: "s1",
      role: "assistant" as const,
      timestamp: 2,
      content: [],
      tokenUsage: { input: 0, output: 0, totalPromptInput },
    },
  ];
}

function seed(opts: {
  messages: unknown[];
  contextWindow?: number;
  historyHydrated?: boolean;
  compaction?: { status: string; estimatedTokens?: number };
}) {
  useAppStore.setState({
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: opts.historyHydrated ?? true,
        messages: opts.messages,
        contextWindow: opts.contextWindow,
        compaction: opts.compaction ?? { status: "idle" },
      },
    },
  } as never);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(<ContextSection />));
}

const text = () => container.textContent ?? "";
const rows = () => Array.from(container.querySelectorAll("li"));

describe("ContextSection", () => {
  it("renders every category row with tokens and percent", async () => {
    seed({ messages: withUsage(50_000), contextWindow: 100_000 });
    await render();

    expect(text()).toContain("overview.context.breakdownUser");
    expect(text()).toContain("overview.context.breakdownSystem");
    expect(text()).toContain("overview.context.breakdownFree");
    expect(text()).toContain("≈100");
    expect(text()).toContain("50%");
  });

  it("marks only the occupied rows as estimates", async () => {
    seed({ messages: withUsage(50_000), contextWindow: 100_000 });
    await render();

    const estimated = rows().filter((row) => row.textContent?.includes("≈"));
    expect(estimated).toHaveLength(2); // system + user
    expect(rows().at(-1)?.textContent).toContain(
      "overview.context.breakdownFree",
    );
    expect(rows().at(-1)?.textContent).not.toContain("≈");
  });

  it("shows -- and hides the bar when the window is unknown", async () => {
    seed({ messages: withUsage(50_000) });
    await render();

    expect(text()).toContain("--");
    expect(text()).not.toContain("0%");
    expect(container.querySelector('div[aria-hidden="true"]')).toBeNull();
  });

  it("renders no rows when usage is unknown", async () => {
    seed({ messages: withUsage(0), contextWindow: 100_000 });
    await render();

    expect(text()).not.toContain("overview.context.breakdownSystem");
    expect(text()).toContain("overview.context.used");
  });

  it("renders no rows when history is not hydrated yet", async () => {
    seed({
      messages: withUsage(50_000),
      contextWindow: 100_000,
      historyHydrated: false,
    });
    await render();

    expect(text()).not.toContain("overview.context.breakdownSystem");
  });

  it("does not fake a 0-token window total", async () => {
    seed({ messages: withUsage(50_000) });
    await render();

    expect(text()).not.toContain('"total":"0"');
    expect(text()).toContain('"total":"--"');
  });

  it("scales the segmented bar to the used share of the window", async () => {
    seed({ messages: withUsage(50_000), contextWindow: 100_000 });
    await render();

    const widths = Array.from(
      container.querySelectorAll<HTMLElement>("div[aria-hidden='true'] > div"),
    ).map((segment) => Number.parseFloat(segment.style.width));
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(50);
  });

  it("estimates the free row too when the total itself is an estimate", async () => {
    seed({
      messages: withUsage(50_000),
      contextWindow: 100_000,
      compaction: { status: "success", estimatedTokens: 30_000 },
    });
    await render();

    const free = rows().at(-1);
    expect(free?.textContent).toContain("overview.context.breakdownFree");
    expect(free?.textContent).toContain("≈");
  });

  it("keeps the system row after a compaction once it has been measured", async () => {
    // 压缩前：历史 ≈94k / 总量 100k → 测得系统侧残差 ≈6k
    const history = [
      userMessage(376_000),
      {
        id: "usage",
        sessionId: "s1",
        role: "assistant" as const,
        timestamp: 2,
        content: [],
        tokenUsage: { input: 0, output: 0, totalPromptInput: 100_000 },
      },
    ];
    seed({ messages: history, contextWindow: 1_000_000 });
    await render();
    const systemBefore = rows()
      .find((row) => row.textContent?.includes("breakdownSystem"))
      ?.textContent?.match(/≈([\d.]+k?)/)?.[1];
    expect(systemBefore).toBeTruthy();

    // 压缩后：历史仍是全量（≈94k），总量骤降到 10k → 进入折算分支，
    // 残差算不出来，但系统侧份额必须还在，且各行之和等于总量。
    seed({
      messages: [
        userMessage(376_000),
        {
          id: "usage",
          sessionId: "s1",
          role: "assistant" as const,
          timestamp: 2,
          content: [],
          tokenUsage: { input: 0, output: 0, totalPromptInput: 10_000 },
        },
      ],
      contextWindow: 1_000_000,
      compaction: { status: "success", estimatedTokens: 10_000 },
    });
    await render();

    const systemRow = rows().find((row) =>
      row.textContent?.includes("breakdownSystem"),
    );
    expect(systemRow?.textContent).toContain(`≈${systemBefore}`);
    expect(text()).toContain("overview.context.breakdownScaled");
  });

  it("has a locale entry for every label key", () => {
    const read = (locale: unknown, key: string): unknown =>
      key
        .split(".")
        .reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
          locale,
        );

    for (const key of CONTEXT_BREAKDOWN_LABEL_KEYS) {
      expect(read(zh, key), `zh: ${key}`).toBeTruthy();
      expect(read(en, key), `en: ${key}`).toBeTruthy();
    }
  });

  it("keeps every swatch distinct and free's a hollow ring", () => {
    expect(new Set(Object.values(SEGMENT_CLASS)).size).toBe(
      Object.keys(SEGMENT_CLASS).length,
    );
    expect(Object.values(SEGMENT_CLASS)).not.toContain(DOT_CLASS.free);
  });

  it("gives every visible row a distinct swatch", async () => {
    seed({ messages: withUsage(50_000), contextWindow: 100_000 });
    await render();

    const swatches = rows().map(
      (row) => row.querySelector("span")?.className ?? "",
    );
    expect(new Set(swatches).size).toBe(rows().length);
  });
});
