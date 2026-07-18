import { describe, expect, it } from "vitest";
import {
  GUI_FIND_ELEMENT_TOOL,
  MAC_ACCESSIBILITY_SCAN_SCRIPT,
  WINDOWS_ACCESSIBILITY_SCAN_SCRIPT,
  buildAccessibilityQueryResult,
  formatAccessibilityQueryError,
  parseRawAccessibilityScan,
  type RawAccessibilityElement,
  type RawAccessibilityScan,
} from "../../main/mcp/gui-accessibility-query";

const displays = [
  { index: 0, originX: 0, originY: 0, width: 1920, height: 1080 },
  { index: 1, originX: -1280, originY: 0, width: 1280, height: 1024 },
  { index: 2, originX: 0, originY: -900, width: 1440, height: 900 },
] as const;

function element(
  overrides: Partial<RawAccessibilityElement> = {},
): RawAccessibilityElement {
  return {
    name: "Save",
    role: "AXButton",
    description: "",
    identifier: "",
    value: "",
    x: 100,
    y: 100,
    width: 80,
    height: 40,
    order: 0,
    ...overrides,
  };
}

function scan(elements: RawAccessibilityElement[]): RawAccessibilityScan {
  return {
    elements,
    scannedNodes: elements.length,
    scanTruncated: false,
  };
}

describe("GUI_FIND_ELEMENT_TOOL", () => {
  it("requires text and exposes optional role", () => {
    expect(GUI_FIND_ELEMENT_TOOL.name).toBe("gui_find_element");
    expect(GUI_FIND_ELEMENT_TOOL.inputSchema.required).toEqual(["text"]);
    expect(GUI_FIND_ELEMENT_TOOL.inputSchema.properties.text.minLength).toBe(1);
    expect(GUI_FIND_ELEMENT_TOOL.inputSchema.properties.role.minLength).toBe(1);
  });
});

describe("platform scan scripts", () => {
  it("uses fixed bounded macOS traversal", () => {
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain("MAX_DEPTH = 6");
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain("MAX_NODES = 500");
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain("MAX_TEXT_LENGTH = 256");
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain(
      'Application("System Events")',
    );
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain(
      "const roots = frontmostProcess.windows().concat(frontmostProcess.menuBars());",
    );
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain("element.properties()");
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain(
      'element.attributes.byName("AXIdentifier").value()',
    );
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).not.toContain("element.attributes()");
    expect(MAC_ACCESSIBILITY_SCAN_SCRIPT).toContain(
      'role === "AXMenu" && (!hasUsableBounds)',
    );
  });

  it("starts Windows UIA traversal from the foreground window", () => {
    expect(WINDOWS_ACCESSIBILITY_SCAN_SCRIPT).toContain("GetForegroundWindow");
    expect(WINDOWS_ACCESSIBILITY_SCAN_SCRIPT).toContain(
      "AutomationElement]::FromHandle",
    );
    expect(WINDOWS_ACCESSIBILITY_SCAN_SCRIPT).toContain("MAX_NODES = 500");
    expect(WINDOWS_ACCESSIBILITY_SCAN_SCRIPT).toContain(
      "$MAX_TEXT_LENGTH = 256",
    );
  });
});

describe("formatAccessibilityQueryError", () => {
  it("sanitizes macOS command output and recognizes localized permission denial", () => {
    const result = formatAccessibilityQueryError(
      "darwin",
      new Error(
        'Command failed: /usr/bin/osascript -e "const secret = 1"\nexecution error: “osascript”不允许辅助访问。 (-25211)',
      ),
    );

    expect(result).toContain("execution error");
    expect(result).toContain("Accessibility：允许 DeskWand");
    expect(result).not.toContain("const secret");
  });

  it("reports timeouts without leaking the platform script", () => {
    const result = formatAccessibilityQueryError(
      "darwin",
      new Error(
        `Command timed out after 5000ms: ${MAC_ACCESSIBILITY_SCAN_SCRIPT}`,
      ),
    );

    expect(result).toBe("macOS accessibility query timed out after 5 seconds.");
    expect(result).not.toContain("MAX_DEPTH");
  });

  it("adds equal-privilege guidance for Windows access denial", () => {
    const result = formatAccessibilityQueryError(
      "win32",
      new Error(
        "Command failed: powershell <encoded-script>\nUnauthorizedAccessException: Access is denied",
      ),
    );

    expect(result).toContain("Access is denied");
    expect(result).toContain("same privilege level");
    expect(result).not.toContain("encoded-script");
  });
});

describe("parseRawAccessibilityScan", () => {
  it("parses a valid bounded scan", () => {
    const result = parseRawAccessibilityScan(
      JSON.stringify({
        elements: [element()],
        scannedNodes: 7,
        scanTruncated: false,
      }),
    );

    expect(result).toEqual({
      elements: [element()],
      scannedNodes: 7,
      scanTruncated: false,
    });
  });

  it("rejects a malformed envelope", () => {
    expect(() => parseRawAccessibilityScan("{}")).toThrow(
      "Invalid accessibility scan output",
    );
    expect(() => parseRawAccessibilityScan("not-json")).toThrow(
      "Failed to parse accessibility scan output",
    );
  });

  it("bounds accessibility text fields", () => {
    const oversized = "x".repeat(5000);
    const result = parseRawAccessibilityScan(
      JSON.stringify({
        elements: [
          element({
            name: oversized,
            description: oversized,
            identifier: oversized,
            value: oversized,
          }),
        ],
        scannedNodes: 1,
        scanTruncated: false,
      }),
    );

    expect(result.elements[0].name).toHaveLength(256);
    expect(result.elements[0].description).toHaveLength(256);
    expect(result.elements[0].identifier).toHaveLength(256);
    expect(result.elements[0].value).toHaveLength(256);
  });

  it("rejects an entirely invalid non-empty scan", () => {
    expect(() =>
      parseRawAccessibilityScan(
        JSON.stringify({
          elements: [{ name: "Bad", x: "not-a-number" }],
          scannedNodes: 1,
          scanTruncated: false,
        }),
      ),
    ).toThrow("Accessibility scan contained no valid elements");
  });
});

describe("buildAccessibilityQueryResult", () => {
  it("normalizes common macOS and Windows button roles", () => {
    const result = buildAccessibilityQueryResult(
      scan([
        element({ name: "Save as copy", role: "AXButton", order: 0 }),
        element({ name: "Save", role: "ControlType.Button", order: 1 }),
        element({ name: "Save", role: "ControlType.Edit", order: 2 }),
      ]),
      { text: "save", role: "button" },
      displays,
      "macos-accessibility",
      12,
    );

    expect(result.matches.map((match) => match.name)).toEqual([
      "Save",
      "Save as copy",
    ]);
    expect(result.matches[0]).toMatchObject({
      role: "button",
      platformRole: "ControlType.Button",
      matchType: "exact",
    });
  });

  it("maps AXTextField and ControlType.Edit to textfield", () => {
    const result = buildAccessibilityQueryResult(
      scan([
        element({ name: "Search", role: "AXTextField", order: 0 }),
        element({ name: "Search", role: "ControlType.Edit", order: 1 }),
      ]),
      { text: "search", role: "textfield" },
      displays,
      "windows-uia",
      8,
    );

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.role === "textfield")).toBe(
      true,
    );
  });

  it("ranks exact, prefix, then contains matches and preserves tree order", () => {
    const result = buildAccessibilityQueryResult(
      scan([
        element({ name: "Autosave status", order: 0 }),
        element({ name: "Save copy", order: 1 }),
        element({ name: "Save later", order: 3 }),
        element({ name: "Save", order: 2 }),
      ]),
      { text: "save" },
      displays,
      "macos-accessibility",
      10,
    );

    expect(result.matches.map((match) => match.name)).toEqual([
      "Save",
      "Save copy",
      "Save later",
      "Autosave status",
    ]);
    expect(result.matches.map((match) => match.matchType)).toEqual([
      "exact",
      "prefix",
      "prefix",
      "contains",
    ]);
  });

  it("ranks an exact name above exact secondary-field matches", () => {
    const result = buildAccessibilityQueryResult(
      scan([
        element({ name: "Description match", description: "Save", order: 0 }),
        element({ name: "Identifier match", identifier: "save", order: 1 }),
        element({ name: "Value match", value: "SAVE", order: 2 }),
        element({ name: "Save", order: 3 }),
      ]),
      { text: "save" },
      displays,
      "macos-accessibility",
      6,
    );

    expect(result.matches.map((match) => match.name)).toEqual([
      "Save",
      "Description match",
      "Identifier match",
      "Value match",
    ]);
    expect(result.matches.every((match) => match.matchType === "exact")).toBe(
      true,
    );
  });

  it("returns eight matches and marks a ninth as truncated", () => {
    const result = buildAccessibilityQueryResult(
      scan(
        Array.from({ length: 9 }, (_, index) =>
          element({ name: `Save ${index}`, order: index }),
        ),
      ),
      { text: "save" },
      displays,
      "macos-accessibility",
      5,
    );

    expect(result.matches).toHaveLength(8);
    expect(result.truncated).toBe(true);
  });

  it("preserves scan truncation with fewer than eight matches", () => {
    const result = buildAccessibilityQueryResult(
      { ...scan([element()]), scanTruncated: true, scannedNodes: 500 },
      { text: "save" },
      displays,
      "macos-accessibility",
      5,
    );

    expect(result.truncated).toBe(true);
    expect(result.scannedNodes).toBe(500);
  });

  it("converts global centers to display-local coordinates", () => {
    const left = buildAccessibilityQueryResult(
      scan([
        element({
          name: "Left",
          x: -1200,
          y: 100,
          width: 100,
          height: 40,
        }),
      ]),
      { text: "left" },
      displays,
      "macos-accessibility",
      4,
    );
    expect(left.matches[0]).toMatchObject({
      x: 130,
      y: 120,
      displayIndex: 1,
    });

    const upper = buildAccessibilityQueryResult(
      scan([
        element({
          name: "Upper",
          x: 200,
          y: -800,
          width: 80,
          height: 40,
        }),
      ]),
      { text: "upper" },
      displays,
      "macos-accessibility",
      4,
    );
    expect(upper.matches[0]).toMatchObject({
      x: 240,
      y: 120,
      displayIndex: 2,
    });
  });

  it("excludes elements outside every display", () => {
    const result = buildAccessibilityQueryResult(
      scan([element({ x: 5000, y: 5000 })]),
      { text: "save" },
      displays,
      "macos-accessibility",
      3,
    );

    expect(result.matches).toEqual([]);
  });

  it("rejects empty query text", () => {
    expect(() =>
      buildAccessibilityQueryResult(
        scan([element()]),
        { text: "   " },
        displays,
        "macos-accessibility",
        2,
      ),
    ).toThrow("text must not be empty");
  });
});
