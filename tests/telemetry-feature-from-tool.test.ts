import { describe, expect, it } from "vitest";
import { featureForTool } from "../src/main/telemetry-feature-from-tool";

describe("featureForTool", () => {
  it("maps known agent tools to a feature", () => {
    expect(featureForTool("bash")).toBe("sandbox");
    expect(featureForTool("office_read_xlsx")).toBe("office_read");
    expect(featureForTool("office_read_pdf")).toBe("office_read");
    expect(featureForTool("memory_upsert")).toBe("memory");
    expect(featureForTool("memory_read")).toBe("memory");
    expect(featureForTool("internal_browser_navigate")).toBe("browser_agent");
    expect(featureForTool("internal_browser_screenshot")).toBe(
      "browser_agent",
    );
    expect(featureForTool("vision_describe")).toBe("vision");
    expect(featureForTool("ocr")).toBe("ocr");
    expect(featureForTool("tts")).toBe("tts");
    expect(featureForTool("set_voice")).toBe("voice_set");
    expect(featureForTool("todo_write")).toBe("todo");
    expect(featureForTool("skill_create")).toBe("skill_curate");
    expect(featureForTool("skill_patch")).toBe("skill_curate");
    expect(featureForTool("Agent")).toBe("subagent");
    expect(featureForTool("SubagentWorkflow")).toBe("subagent");
    // Steering or collecting an already-dispatched subagent is not a dispatch.
    expect(featureForTool("get_subagent_result")).toBeNull();
    expect(featureForTool("steer_subagent")).toBeNull();
  });

  it("returns null for anything not on the whitelist", () => {
    // Skills can register arbitrary tool names — they must never reach the wire.
    expect(featureForTool("my_custom_skill_tool")).toBeNull();
    expect(featureForTool("")).toBeNull();
    expect(featureForTool("bash ")).toBeNull();
  });

  it("does not resolve inherited object keys", () => {
    // Tool names are effectively untrusted input; an object literal here would
    // hand back `Object.prototype` members as if they were mapped features.
    for (const key of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(featureForTool(key)).toBeNull();
    }
  });

  it("matches browser tools by exact name, not by prefix", () => {
    expect(featureForTool("internal_browser_navigate")).toBe("browser_agent");
    expect(featureForTool("internal_browser_my_custom_skill_tool")).toBeNull();
  });

  it("never throws, whatever it is handed", () => {
    // This runs on the message-build path; a throw here would kill the turn.
    expect(() => featureForTool(undefined as unknown as string)).not.toThrow();
    expect(featureForTool(undefined as unknown as string)).toBeNull();
  });
});
