export const MAX_ACCESSIBILITY_DEPTH = 6;
export const MAX_ACCESSIBILITY_NODES = 500;
export const MAX_ACCESSIBILITY_MATCHES = 8;
export const MAX_ACCESSIBILITY_TEXT_LENGTH = 256;

export const GUI_FIND_ELEMENT_TOOL = {
  name: "gui_find_element",
  description:
    "Search the frontmost application's accessibility tree by text and optional role. Use this before gui_locate_element when a control has visible text or a known semantic role. Use gui_locate_element for purely visual or inaccessible controls.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        minLength: 1,
        description:
          "Case-insensitive text matched against accessibility name, description, identifier, or scalar value.",
      },
      role: {
        type: "string",
        minLength: 1,
        description:
          "Optional canonical role such as button, textfield, checkbox, menuitem, radio, or link. Raw platform roles are also accepted.",
      },
    },
    required: ["text"],
  },
};

export interface RawAccessibilityElement {
  name: string;
  role: string;
  description: string;
  identifier: string;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
}

export interface RawAccessibilityScan {
  elements: RawAccessibilityElement[];
  scannedNodes: number;
  scanTruncated: boolean;
}

export interface AccessibilityDisplay {
  index: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export type AccessibilitySource = "macos-accessibility" | "windows-uia";
export type AccessibilityMatchType = "exact" | "prefix" | "contains";

export interface AccessibilityElementMatch {
  name: string;
  role: string;
  platformRole: string;
  description: string;
  matchType: AccessibilityMatchType;
  x: number;
  y: number;
  width: number;
  height: number;
  displayIndex: number;
}

export interface AccessibilityQueryResult {
  source: AccessibilitySource;
  matches: AccessibilityElementMatch[];
  truncated: boolean;
  scannedNodes: number;
  elapsedMs: number;
}

export const MAC_ACCESSIBILITY_SCAN_SCRIPT = String.raw`
const MAX_DEPTH = 6;
const MAX_NODES = 500;
const MAX_TEXT_LENGTH = 256;
const systemEvents = Application("System Events");
const frontmostProcesses = systemEvents.processes.whose({ frontmost: true });
const frontmostProcess = frontmostProcesses.length > 0 ? frontmostProcesses[0] : null;
if (!frontmostProcess) throw new Error("No frontmost application process.");

const elements = [];
let scannedNodes = 0;
let scanTruncated = false;

function scalar(value) {
  if (value === null || value === undefined) return "";
  const kind = typeof value;
  return kind === "string" || kind === "number" || kind === "boolean"
    ? String(value).slice(0, MAX_TEXT_LENGTH)
    : "";
}

function read(getter) {
  try { return scalar(getter()); } catch (_) { return ""; }
}

function property(properties, names) {
  for (let index = 0; index < names.length; index += 1) {
    const candidate = scalar(properties[names[index]]);
    if (candidate) return candidate;
  }
  return "";
}

function walk(element, depth) {
  if (scannedNodes >= MAX_NODES) {
    scanTruncated = true;
    return;
  }
  scannedNodes += 1;
  const order = scannedNodes - 1;

  let properties = {};
  try { properties = element.properties(); } catch (_) {}
  const name = property(properties, ["name", "title"]);
  const role = property(properties, ["role"]);
  const description = property(properties, [
    "accessibilityDescription", "help", "description",
  ]);
  const identifier = read(() =>
    element.attributes.byName("AXIdentifier").value()
  );
  const value = property(properties, ["value"]);
  const position = properties.position || [];
  const size = properties.size || [];
  const x = Number(position[0]);
  const y = Number(position[1]);
  const width = Number(size[0]);
  const height = Number(size[1]);
  const hasUsableBounds =
    Number.isFinite(x) && Number.isFinite(y) &&
    Number.isFinite(width) && Number.isFinite(height) &&
    width > 0 && height > 0;

  if (hasUsableBounds && (name || description || identifier || value)) {
    elements.push({
      name, role, description, identifier, value,
      x, y, width, height, order,
    });
  }

  if (role === "AXMenu" && (!hasUsableBounds)) return;

  let children = [];
  try { children = element.uiElements(); } catch (_) {}
  if (depth >= MAX_DEPTH) {
    if (children.length > 0) scanTruncated = true;
    return;
  }
  for (let index = 0; index < children.length; index += 1) {
    walk(children[index], depth + 1);
    if (scannedNodes >= MAX_NODES) break;
  }
}

const roots = frontmostProcess.windows().concat(frontmostProcess.menuBars());
for (let index = 0; index < roots.length; index += 1) {
  walk(roots[index], 0);
  if (scannedNodes >= MAX_NODES) break;
}

JSON.stringify({ elements, scannedNodes, scanTruncated });
`;

export const WINDOWS_ACCESSIBILITY_SCAN_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DeskWandAccessibilityNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@

$MAX_DEPTH = 6
$MAX_NODES = 500
$MAX_TEXT_LENGTH = 256
$script:scannedNodes = 0
$script:scanTruncated = $false
$script:elements = New-Object System.Collections.Generic.List[object]
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Limit-Text([object]$value) {
  $text = [string]$value
  if ($text.Length -gt $MAX_TEXT_LENGTH) {
    return $text.Substring(0, $MAX_TEXT_LENGTH)
  }
  return $text
}

function Get-ScalarValue([System.Windows.Automation.AutomationElement]$element) {
  try {
    $pattern = $null
    if ($element.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,
      [ref]$pattern
    )) {
      return ([System.Windows.Automation.ValuePattern]$pattern).Current.Value
    }
  } catch {}
  return ""
}

function Walk-AccessibilityElement(
  [System.Windows.Automation.AutomationElement]$element,
  [int]$depth
) {
  if ($null -eq $element) { return }
  if ($script:scannedNodes -ge $MAX_NODES) {
    $script:scanTruncated = $true
    return
  }

  $order = $script:scannedNodes
  $script:scannedNodes += 1

  try {
    $current = $element.Current
    $name = Limit-Text $current.Name
    $role = Limit-Text $current.ControlType.ProgrammaticName
    $description = Limit-Text $current.HelpText
    $identifier = Limit-Text $current.AutomationId
    $value = Limit-Text (Get-ScalarValue $element)
    $rect = $current.BoundingRectangle

    if (
      -not $rect.IsEmpty -and
      $rect.Width -gt 0 -and
      $rect.Height -gt 0 -and
      ($name -or $description -or $identifier -or $value)
    ) {
      $script:elements.Add([PSCustomObject]@{
        name = $name
        role = $role
        description = $description
        identifier = $identifier
        value = $value
        x = [double]$rect.X
        y = [double]$rect.Y
        width = [double]$rect.Width
        height = [double]$rect.Height
        order = $order
      })
    }
  } catch {}

  $child = $null
  try { $child = $walker.GetFirstChild($element) } catch {}
  if ($depth -ge $MAX_DEPTH) {
    if ($null -ne $child) { $script:scanTruncated = $true }
    return
  }

  while ($null -ne $child) {
    Walk-AccessibilityElement $child ($depth + 1)
    if ($script:scannedNodes -ge $MAX_NODES) { break }
    try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
  }
}

$handle = [DeskWandAccessibilityNative]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { throw "No foreground window." }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { throw "Unable to resolve the foreground UI Automation root." }
Walk-AccessibilityElement $root 0

@{
  elements = @($script:elements)
  scannedNodes = $script:scannedNodes
  scanTruncated = $script:scanTruncated
} | ConvertTo-Json -Depth 4 -Compress
`;

const ROLE_ALIASES = {
  button: ["axbutton", "controltype.button"],
  textfield: ["axtextfield", "axtextarea", "controltype.edit"],
  checkbox: ["axcheckbox", "controltype.checkbox"],
  menu: ["axmenu", "controltype.menu"],
  menuitem: ["axmenuitem", "controltype.menuitem"],
  radio: ["axradiobutton", "controltype.radiobutton"],
  link: ["axlink", "controltype.hyperlink"],
} as const;

type CanonicalRole = keyof typeof ROLE_ALIASES;

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const diagnostic = lines
    .filter((line) =>
      /execution error|exception|access is denied|unauthorized|not authorized|不允许辅助访问|-25211|-1743/i.test(
        line,
      ),
    )
    .at(-1);
  return (diagnostic ?? lines.at(-1) ?? "Accessibility query failed.").slice(
    0,
    500,
  );
}

export function formatAccessibilityQueryError(
  platform: string,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    const platformName = platform === "win32" ? "Windows" : "macOS";
    return `${platformName} accessibility query timed out after 5 seconds.`;
  }

  const detail = errorDetail(error);
  if (
    platform === "darwin" &&
    /not authorized|-1743|-25211|不允许辅助访问|assistive|permission/i.test(
      detail,
    )
  ) {
    return (
      `${detail}\n\nmacOS 权限提示 / Permissions:\n` +
      "- System Settings → Privacy & Security → Accessibility：允许 DeskWand\n" +
      '- System Settings → Privacy & Security → Automation：允许 DeskWand 控制 "System Events"\n' +
      "- 授权后请重启 DeskWand 再重试"
    );
  }
  if (
    platform === "win32" &&
    /access is denied|unauthorized|privilege|permission/i.test(detail)
  ) {
    return (
      `${detail}\n\nWindows permission hint: ` +
      "DeskWand cannot inspect an application running at a higher integrity level. " +
      "Run both applications at the same privilege level."
    );
  }
  return detail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string"
    ? value.slice(0, MAX_ACCESSIBILITY_TEXT_LENGTH)
    : "";
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseElement(value: unknown): RawAccessibilityElement | null {
  if (!isRecord(value)) return null;
  const x = readFiniteNumber(value.x);
  const y = readFiniteNumber(value.y);
  const width = readFiniteNumber(value.width);
  const height = readFiniteNumber(value.height);
  const order = readFiniteNumber(value.order);
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    order === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    name: readString(value.name),
    role: readString(value.role),
    description: readString(value.description),
    identifier: readString(value.identifier),
    value: readString(value.value),
    x,
    y,
    width,
    height,
    order,
  };
}

export function parseRawAccessibilityScan(
  output: string,
): RawAccessibilityScan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("Failed to parse accessibility scan output.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.elements)) {
    throw new Error("Invalid accessibility scan output.");
  }
  const rawElements: unknown[] = parsed.elements;
  if (rawElements.length > MAX_ACCESSIBILITY_NODES) {
    throw new Error("Accessibility scan exceeded the element limit.");
  }
  const scannedNodes = readFiniteNumber(parsed.scannedNodes);
  if (
    scannedNodes === null ||
    scannedNodes < 0 ||
    scannedNodes > MAX_ACCESSIBILITY_NODES ||
    typeof parsed.scanTruncated !== "boolean"
  ) {
    throw new Error("Invalid accessibility scan output.");
  }

  const elements = rawElements
    .map((value) => parseElement(value))
    .filter((value): value is RawAccessibilityElement => value !== null);
  if (rawElements.length > 0 && elements.length === 0) {
    throw new Error("Accessibility scan contained no valid elements.");
  }
  return {
    elements,
    scannedNodes: Math.trunc(scannedNodes),
    scanTruncated: parsed.scanTruncated,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isCanonicalRole(value: string): value is CanonicalRole {
  return Object.prototype.hasOwnProperty.call(ROLE_ALIASES, value);
}

function canonicalizeRole(rawRole: string): string {
  const normalized = normalize(rawRole);
  for (const [role, aliases] of Object.entries(ROLE_ALIASES) as Array<
    [CanonicalRole, readonly string[]]
  >) {
    if (aliases.includes(normalized)) return role;
  }
  return rawRole;
}

function roleMatches(
  rawRole: string,
  requestedRole: string | undefined,
): boolean {
  const requested = normalize(requestedRole ?? "");
  if (!requested) return true;
  if (isCanonicalRole(requested)) {
    return canonicalizeRole(rawRole) === requested;
  }
  return normalize(rawRole).includes(requested);
}

function textMatch(
  element: RawAccessibilityElement,
  query: string,
): { rank: number; matchType: AccessibilityMatchType } | null {
  const name = normalize(element.name);
  const secondary = [element.identifier, element.description, element.value]
    .map(normalize)
    .filter(Boolean);
  const all = [name, ...secondary].filter(Boolean);
  if (name === query) return { rank: 0, matchType: "exact" };
  if (secondary.some((value) => value === query)) {
    return { rank: 1, matchType: "exact" };
  }
  if (all.some((value) => value.startsWith(query))) {
    return { rank: 2, matchType: "prefix" };
  }
  if (all.some((value) => value.includes(query))) {
    return { rank: 3, matchType: "contains" };
  }
  return null;
}

function mapToDisplay(
  element: RawAccessibilityElement,
  displays: readonly AccessibilityDisplay[],
): Pick<
  AccessibilityElementMatch,
  "x" | "y" | "width" | "height" | "displayIndex"
> | null {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const display = displays.find(
    (candidate) =>
      centerX >= candidate.originX &&
      centerX < candidate.originX + candidate.width &&
      centerY >= candidate.originY &&
      centerY < candidate.originY + candidate.height,
  );
  if (!display) return null;
  return {
    x: Math.round(centerX - display.originX),
    y: Math.round(centerY - display.originY),
    width: Math.max(1, Math.round(element.width)),
    height: Math.max(1, Math.round(element.height)),
    displayIndex: display.index,
  };
}

export function buildAccessibilityQueryResult(
  scan: RawAccessibilityScan,
  query: { text: string; role?: string },
  displays: readonly AccessibilityDisplay[],
  source: AccessibilitySource,
  elapsedMs: number,
): AccessibilityQueryResult {
  const normalizedText = normalize(query.text);
  if (!normalizedText) {
    throw new Error("gui_find_element text must not be empty.");
  }

  const ranked = scan.elements.flatMap((element) => {
    if (!roleMatches(element.role, query.role)) return [];
    const match = textMatch(element, normalizedText);
    if (!match) return [];
    const coordinates = mapToDisplay(element, displays);
    if (!coordinates) return [];
    return [{ element, ...match, coordinates }];
  });
  ranked.sort(
    (left, right) =>
      left.rank - right.rank || left.element.order - right.element.order,
  );

  const matches = ranked.slice(0, MAX_ACCESSIBILITY_MATCHES).map(
    ({ element, matchType, coordinates }): AccessibilityElementMatch => ({
      name: element.name,
      role: canonicalizeRole(element.role),
      platformRole: element.role,
      description: element.description,
      matchType,
      ...coordinates,
    }),
  );

  return {
    source,
    matches,
    truncated: scan.scanTruncated || ranked.length > MAX_ACCESSIBILITY_MATCHES,
    scannedNodes: scan.scannedNodes,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
}
