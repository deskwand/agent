// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ContentBlockView } from "../../renderer/components/message/ContentBlockView";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("i18nextLng", "en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderAssistantMarkdown(text: string): Promise<string[]> {
  const warnings: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (message.includes("same key")) warnings.push(message);
  });

  await act(async () => {
    root.render(
      React.createElement(ContentBlockView, {
        block: { type: "text", text },
        isUser: false,
      }),
    );
  });
  await act(async () => {});
  return warnings;
}

// react-markdown keys element children `<tagName>-<n>`; a nested element of the
// same tag (bold-in-bold, em-in-em) keeps that key while the sibling text part
// gets a generated key, so the two namespaces must not overlap.
const NESTED_SAME_TAG_CASES = ["**see **bold** and src/a.ts**", "*a _b_ c*"];

describe("assistant markdown child keys", () => {
  it.each(NESTED_SAME_TAG_CASES)(
    "no duplicate sibling keys for %j",
    async (text) => {
      const warnings = await renderAssistantMarkdown(text);
      expect(warnings).toEqual([]);
    },
  );

  it("keeps the file mention button inside nested bold", async () => {
    await renderAssistantMarkdown("**see **bold** and src/a.ts**");
    const labels = Array.from(
      container.querySelectorAll("button"),
      (el) => el.textContent,
    );
    expect(labels).toContain("src/a.ts");
  });
});
