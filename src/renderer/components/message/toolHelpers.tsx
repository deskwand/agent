// Utility functions for tool use/result display
import type { TFunction } from "i18next";
import {
  Terminal,
  FileCode,
  FileText,
  Pencil,
  Search,
  Globe,
  FolderSearch,
} from "lucide-react";

/** Map a tool name to a small icon element */
export function getToolIcon(name: string) {
  const n = name.toLowerCase();
  if (n === "bash" || n === "execute_command")
    return <Terminal className="w-3.5 h-3.5" />;
  if (n === "read" || n === "read_file")
    return <FileCode className="w-3.5 h-3.5" />;
  if (n === "write" || n === "write_file")
    return <FileText className="w-3.5 h-3.5" />;
  if (n === "edit" || n === "edit_file")
    return <Pencil className="w-3.5 h-3.5" />;
  if (n === "grep") return <Search className="w-3.5 h-3.5" />;
  if (n === "glob") return <FolderSearch className="w-3.5 h-3.5" />;
  if (n === "websearch") return <Globe className="w-3.5 h-3.5" />;
  if (n === "webfetch") return <Globe className="w-3.5 h-3.5" />;
  if (n.startsWith("internal_browser"))
    return <Globe className="w-3.5 h-3.5" />;
  return <Terminal className="w-3.5 h-3.5" />;
}

/** Shorten a file path to just filename or last 2 segments */
export function shortenPath(p: string): string {
  if (typeof p !== "string") return String(p);
  const segments = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 2) return segments.join("/");
  return segments.slice(-2).join("/");
}

/** Get compact label: tool action + key argument */
export function getToolLabel(
  name: string,
  input: Record<string, unknown>,
  t: TFunction,
): string {
  const inp = input || {};
  // MCP tools
  if (name.startsWith("mcp__")) {
    const match = name.match(/^mcp__(.+?)__(.+)$/);
    return match?.[2] || name;
  }

  const nameLower = name.toLowerCase();

  // --- File tools ---
  if (nameLower === "read" || nameLower === "read_file") {
    const p = String(inp.file_path || inp.path || "");
    return p
      ? t("tool.labelRead", { path: shortenPath(p) })
      : t("tool.actionRead");
  }
  if (nameLower === "write" || nameLower === "write_file") {
    const p = String(inp.file_path || inp.path || "");
    return p
      ? t("tool.labelWrite", { path: shortenPath(p) })
      : t("tool.actionWrite");
  }
  if (nameLower === "edit" || nameLower === "edit_file") {
    const p = String(inp.file_path || inp.path || "");
    return p
      ? t("tool.labelEdit", { path: shortenPath(p) })
      : t("tool.actionEdit");
  }
  if (nameLower === "bash" || nameLower === "execute_command") {
    const cmd = String(inp.command || inp.cmd || "");
    if (cmd) {
      const short = cmd.length > 60 ? cmd.substring(0, 57) + "..." : cmd;
      return t("tool.labelBash", { command: short });
    }
    return t("tool.actionBash");
  }
  if (nameLower === "glob") {
    return inp.pattern
      ? t("tool.labelGlob", { pattern: String(inp.pattern) })
      : t("tool.actionGlob");
  }
  if (nameLower === "grep") {
    return inp.pattern
      ? t("tool.labelGrep", { pattern: String(inp.pattern) })
      : t("tool.actionGrep");
  }
  if (nameLower === "websearch") {
    return inp.query
      ? t("tool.labelWebSearch", { query: String(inp.query) })
      : t("tool.actionWebSearch");
  }
  if (nameLower === "webfetch") {
    const url = String(inp.url || "");
    return url
      ? t("tool.labelWebFetch", {
          url: url.length > 50 ? url.substring(0, 47) + "..." : url,
        })
      : t("tool.actionWebFetch");
  }

  // --- Browser tools ---
  if (nameLower === "internal_browser_navigate") {
    const url = String(inp.url || "");
    return url
      ? t("tool.labelBrowserNavigate", { url })
      : t("tool.actionBrowserNavigate");
  }
  if (nameLower === "internal_browser_screenshot")
    return t("tool.actionBrowserScreenshot");
  if (nameLower === "internal_browser_click") {
    const selector = String(inp.selector || "");
    return selector
      ? t("tool.labelBrowserClick", { selector })
      : t("tool.actionBrowserClick");
  }
  if (nameLower === "internal_browser_fill") {
    const text = String(inp.text || "");
    return text
      ? t("tool.labelBrowserFill", { text })
      : t("tool.actionBrowserFill");
  }
  if (nameLower === "internal_browser_scroll") {
    const dx = Number(inp.dx ?? 0);
    const dy = Number(inp.dy ?? 0);
    return t("tool.labelBrowserScroll", { dx, dy });
  }
  if (nameLower === "internal_browser_hover") {
    const selector = String(inp.selector || "");
    return t("tool.labelBrowserHover", { selector });
  }
  if (nameLower === "internal_browser_select") {
    const value = String(inp.value || "");
    return t("tool.labelBrowserSelect", { value });
  }
  if (nameLower === "internal_browser_press") {
    const key = String(inp.key || "");
    return t("tool.labelBrowserPress", { key });
  }
  if (nameLower === "internal_browser_snapshot")
    return t("tool.actionBrowserSnapshot");
  if (nameLower === "internal_browser_evaluate") {
    const script = String(inp.script || "");
    return script
      ? t("tool.labelBrowserEvaluate", { script })
      : t("tool.actionBrowserEvaluate");
  }
  if (nameLower === "internal_browser_wait_for") {
    const text = String(inp.text || "");
    const selector = String(inp.selector || "");
    if (text) return t("tool.labelBrowserWaitText", { text });
    if (selector)
      return t("tool.labelBrowserWaitSelector", { selector });
    return t("tool.actionBrowserWait");
  }
  if (nameLower === "internal_browser_get_state")
    return t("tool.actionBrowserGetState");

  return name;
}
