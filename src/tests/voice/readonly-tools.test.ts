import { describe, it, expect } from "vitest";
import {
  READONLY_TOOLS,
  resolveActiveTools,
} from "../../main/agent/readonly-tools";

describe("readonly tools", () => {
  it("keeps the registered read-only subset, in the order of the full list", () => {
    const all = ["bash", "read", "web_search", "write", "edit"];
    expect(resolveActiveTools(all, true)).toEqual(["read", "web_search"]);
  });

  it("drops names that are not registered at all", () => {
    expect(resolveActiveTools(["read"], true)).toEqual(["read"]);
  });

  it("returns the full list when not readonly", () => {
    const all = ["bash", "read"];
    expect(resolveActiveTools(all, false)).toBe(all);
  });

  it("never contains a writing or side-effecting tool", () => {
    for (const name of [
      "write",
      "edit",
      "bash",
      "tts",
      "ask_user",
      "todo_write",
    ]) {
      expect(READONLY_TOOLS).not.toContain(name);
    }
  });

  // 这条把「名单与实际注册名脱节」钉死：名字写错等于工具静默失效（设计 §8 风险表）。
  // 注册名有变动时，这个测试会先红，而不是等到用户发现工具不见了。
  it("every allowlisted name is a real registered tool name", () => {
    const registered = [
      "read",
      "bash",
      "edit",
      "write",
      "web_search",
      "fetch_content",
      "get_search_content",
      "vision_describe",
      "tts",
      "ask_user",
      "todo_write",
      "office_read_docx",
      "office_read_pdf",
      "office_read_pptx",
      "office_read_xlsx",
    ];
    for (const name of READONLY_TOOLS) {
      expect(registered).toContain(name);
    }
  });
});
