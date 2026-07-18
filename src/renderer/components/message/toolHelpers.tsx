// Utility functions for tool use/result display
import type { TFunction } from "i18next";
import {
  MonitorPlay,
  Target,
  BookOpen,
  FileText,
  Pencil,
  Search,
  Globe,
  FolderSearch,
  Eye,
  Table,
  Presentation,
  FileScan,
} from "lucide-react";

/** Map a tool name to a small icon element */
export function getToolIcon(name: string) {
  const n = name.toLowerCase();
  if (n === "bash" || n === "execute_command")
    return <MonitorPlay className="w-3.5 h-3.5" />;
  if (n === "read" || n === "read_file")
    return <BookOpen className="w-3.5 h-3.5" />;
  if (n === "write" || n === "write_file")
    return <FileText className="w-3.5 h-3.5" />;
  if (n === "edit" || n === "edit_file")
    return <Pencil className="w-3.5 h-3.5" />;
  if (n === "grep") return <Search className="w-3.5 h-3.5" />;
  if (n === "glob") return <FolderSearch className="w-3.5 h-3.5" />;
  // Keep legacy names so Web Access calls in historical sessions still render.
  if (
    [
      "websearch",
      "webfetch",
      "web_fetch",
      "web_search",
      "fetch_content",
      "get_search_content",
    ].includes(n)
  )
    return <Globe className="w-3.5 h-3.5" />;
  if (n === "vision_describe") return <Eye className="w-3.5 h-3.5" />;
  if (n === "office_read_xlsx") return <Table className="w-3.5 h-3.5" />;
  if (n === "office_read_docx") return <FileText className="w-3.5 h-3.5" />;
  if (n === "office_read_pptx") return <Presentation className="w-3.5 h-3.5" />;
  if (n === "office_read_pdf") return <FileScan className="w-3.5 h-3.5" />;
  if (n === "get_goal" || n === "update_goal" || n === "goal_complete")
    return <Target className="w-3.5 h-3.5" />;
  if (n.startsWith("internal_browser"))
    return <Globe className="w-3.5 h-3.5" />;
  return <MonitorPlay className="w-3.5 h-3.5" />;
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
      return t("tool.labelBash", { command: cmd });
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
  if (nameLower === "websearch" || nameLower === "web_search") {
    const queries = Array.isArray(inp.queries) ? inp.queries : [];
    if (queries.length > 0) {
      return t("tool.labelWebSearchMany", { count: queries.length });
    }
    return inp.query
      ? t("tool.labelWebSearch", { query: String(inp.query) })
      : t("tool.actionWebSearch");
  }
  if (nameLower === "fetch_content") {
    const urls = Array.isArray(inp.urls) ? inp.urls : [];
    if (urls.length > 0) {
      return t("tool.labelFetchContentMany", { count: urls.length });
    }
    const url = String(inp.url || "");
    return url
      ? t("tool.labelFetchContent", {
          url: url.length > 50 ? url.substring(0, 47) + "..." : url,
        })
      : t("tool.actionFetchContent");
  }
  if (nameLower === "get_search_content") {
    const responseId = String(inp.responseId || "");
    return responseId
      ? t("tool.labelGetSearchContent", {
          responseId: responseId.slice(0, 8),
        })
      : t("tool.actionGetSearchContent");
  }
  if (nameLower === "webfetch" || nameLower === "web_fetch") {
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
    if (selector) return t("tool.labelBrowserWaitSelector", { selector });
    return t("tool.actionBrowserWait");
  }
  if (nameLower === "internal_browser_get_state")
    return t("tool.actionBrowserGetState");

  // --- Office document read tools ---
  if (nameLower === "office_read_xlsx") {
    const p = String(inp.path || "");
    return p
      ? t("tool.labelReadXlsx", { path: shortenPath(p) })
      : t("tool.actionReadXlsx");
  }
  if (nameLower === "office_read_docx") {
    const p = String(inp.path || "");
    return p
      ? t("tool.labelReadDocx", { path: shortenPath(p) })
      : t("tool.actionReadDocx");
  }
  if (nameLower === "office_read_pptx") {
    const p = String(inp.path || "");
    return p
      ? t("tool.labelReadPptx", { path: shortenPath(p) })
      : t("tool.actionReadPptx");
  }
  if (nameLower === "office_read_pdf") {
    const p = String(inp.path || "");
    return p
      ? t("tool.labelReadPdf", { path: shortenPath(p) })
      : t("tool.actionReadPdf");
  }

  // --- Vision tools ---
  if (nameLower === "vision_describe") {
    const p = String(inp.path || "");
    const prompt = String(inp.prompt || "");
    if (p && prompt) {
      return t("tool.labelVisionDescribeWithPrompt", {
        path: shortenPath(p),
        prompt: prompt.length > 40 ? prompt.slice(0, 37) + "…" : prompt,
      });
    }
    return p
      ? t("tool.labelVisionDescribe", { path: shortenPath(p) })
      : t("tool.actionVisionDescribe");
  }

  if (nameLower === "get_goal") {
    return t("tool.actionGetGoal");
  }
  if (nameLower === "update_goal") {
    return t("tool.actionUpdateGoal");
  }
  if (nameLower === "goal_complete") {
    return t("tool.actionGoalComplete");
  }

  return name;
}
