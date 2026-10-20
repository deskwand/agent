import type { TelemetryFeature } from "./telemetry-events";

/**
 * Agent tool name → reported feature. Layer 2 of the telemetry design: the agent
 * doing something on the user's behalf, as opposed to the user acting directly.
 *
 * A Map, not an object literal: tool names are effectively untrusted input, and
 * an object would resolve inherited keys ("constructor", "toString", …) to
 * truthy functions. Only names listed here are reported; anything else resolves
 * to null and never reaches the wire, so no tool parameter, path or arbitrary
 * skill name can leak.
 */
const TOOL_FEATURES = new Map<string, TelemetryFeature>([
  ["bash", "sandbox"],
  ["office_read_xlsx", "office_read"],
  ["office_read_docx", "office_read"],
  ["office_read_pptx", "office_read"],
  ["office_read_pdf", "office_read"],
  ["memory_upsert", "memory"],
  ["memory_delete", "memory"],
  ["memory_search", "memory"],
  ["memory_read", "memory"],
  ["vision_describe", "vision"],
  ["ocr", "ocr"],
  ["tts", "tts"],
  ["set_voice", "voice_set"],
  ["todo_write", "todo"],
  // The background review runner rewrites skills through these.
  ["skill_create", "skill_curate"],
  ["skill_patch", "skill_curate"],
  ["skill_add_reference", "skill_curate"],
  // Dispatching a subagent counts; steering or collecting one does not.
  ["Agent", "subagent"],
  ["SubagentWorkflow", "subagent"],
  // The browser toolset is a fixed family of twelve exact names.
  ["internal_browser_navigate", "browser_agent"],
  ["internal_browser_screenshot", "browser_agent"],
  ["internal_browser_click", "browser_agent"],
  ["internal_browser_fill", "browser_agent"],
  ["internal_browser_scroll", "browser_agent"],
  ["internal_browser_hover", "browser_agent"],
  ["internal_browser_select", "browser_agent"],
  ["internal_browser_press", "browser_agent"],
  ["internal_browser_snapshot", "browser_agent"],
  ["internal_browser_evaluate", "browser_agent"],
  ["internal_browser_wait_for", "browser_agent"],
  ["internal_browser_get_state", "browser_agent"],
]);

export function featureForTool(toolName: string): TelemetryFeature | null {
  if (typeof toolName !== "string") {
    return null;
  }
  return TOOL_FEATURES.get(toolName) ?? null;
}
