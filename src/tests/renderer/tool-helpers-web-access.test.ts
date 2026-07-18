import { Globe } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  getToolIcon,
  getToolLabel,
} from "../../renderer/components/message/toolHelpers";

const labels: Record<string, string> = {
  "tool.actionWebSearch": "Web search",
  "tool.labelWebSearch": 'Search "{{query}}"',
  "tool.labelWebSearchMany": "Search {{count}} queries",
  "tool.actionFetchContent": "Fetch content",
  "tool.labelFetchContent": "Fetch {{url}}",
  "tool.labelFetchContentMany": "Fetch {{count}} URLs",
  "tool.actionGetSearchContent": "Read cached content",
  "tool.labelGetSearchContent": "Read cached result {{responseId}}",
  "tool.actionWebFetch": "Fetch URL",
  "tool.labelWebFetch": "Fetch {{url}}",
};

const t = ((key: string, options?: Record<string, unknown>) => {
  let text = labels[key] ?? key;
  for (const [name, value] of Object.entries(options ?? {})) {
    text = text.replace(`{{${name}}}`, String(value));
  }
  return text;
}) as unknown as TFunction;

describe("Web Access tool labels", () => {
  it.each(["web_search", "fetch_content", "get_search_content", "web_fetch"])(
    "renders a Globe icon for %s",
    (toolName) => {
      expect(getToolIcon(toolName).type).toBe(Globe);
    },
  );

  it("formats single and batch searches", () => {
    expect(getToolLabel("web_search", { query: "TypeScript" }, t)).toBe(
      'Search "TypeScript"',
    );
    expect(getToolLabel("web_search", { queries: ["a", "b"] }, t)).toBe(
      "Search 2 queries",
    );
  });

  it("formats single and batch fetches", () => {
    expect(
      getToolLabel("fetch_content", { url: "https://example.com" }, t),
    ).toBe("Fetch https://example.com");
    expect(getToolLabel("fetch_content", { urls: ["a", "b"] }, t)).toBe(
      "Fetch 2 URLs",
    );
  });

  it("formats cached and historical fetch labels", () => {
    expect(
      getToolLabel("get_search_content", { responseId: "abcdefgh123" }, t),
    ).toBe("Read cached result abcdefgh");
    expect(getToolLabel("web_fetch", { url: "https://old.example" }, t)).toBe(
      "Fetch https://old.example",
    );
  });
});
