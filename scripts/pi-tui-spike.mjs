/**
 * P0.5 spike — 验证官方 TUI 组件在虚拟 Terminal 环境中的渲染与键盘归一化。
 * 通过 → P1 投入 TUI Modal；不通过 → 维持 custom() 降级。
 *
 * 运行: node scripts/pi-tui-spike.mjs
 */
import { TUI, matchesKey, Key } from "@earendil-works/pi-tui";
import { BorderedLoader, ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";

// 官方组件（BorderedLoader 等）依赖全局主题初始化（keyHint/theme 查询）。
// 这是 spike 的核心发现之一：宿主必须先 initTheme 才能使用组件。
initTheme("dark");

// 无色 Theme：fgAnsi("") 返回无色 reset（与 src/main/extensions/ui/theme-utils.ts 同逻辑）。
const THEME_FG_KEYS = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error",
  "warning", "muted", "dim", "text", "thinkingText", "userMessageText",
  "customMessageText", "customMessageLabel", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment",
  "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
  "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax", "bashMode",
];
const THEME_BG_KEYS = [
  "selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg",
  "toolSuccessBg", "toolErrorBg",
];
const spikeTheme = new (await import("@earendil-works/pi-coding-agent")).Theme(
  Object.fromEntries(THEME_FG_KEYS.map((c) => [c, ""])),
  Object.fromEntries(THEME_BG_KEYS.map((c) => [c, ""])),
  "256color",
);

// 内存 Terminal 适配器（spike 版）
class MemoryTerminal {
  constructor(width, height) {
    this._w = width;
    this._h = height;
    this.output = "";
    this.onInput = null;
    this.onResize = null;
  }
  start(onInput, onResize) {
    this.onInput = onInput;
    this.onResize = onResize;
  }
  stop() {}
  drainInput() {
    return Promise.resolve();
  }
  write(data) {
    this.output += data;
  }
  get columns() {
    return this._w;
  }
  get rows() {
    return this._h;
  }
  get kittyProtocolActive() {
    return false;
  }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

// ── 1. 基础渲染 ──
const term = new MemoryTerminal(60, 20);
const tui = new TUI(term);
tui.start();
tui.addChild({ render: () => ["hello world"], invalidate() {} });
tui.requestRender();
await new Promise((r) => setTimeout(r, 80));
check("basic render writes output", term.output.length > 0, `len=${term.output.length}`);

// ── 2. BorderedLoader 渲染 ──
const loader = new BorderedLoader(tui, spikeTheme, "Working...");
tui.addChild(loader);
tui.requestRender();
await new Promise((r) => setTimeout(r, 80));
check("BorderedLoader renders without throwing", term.output.length > 0);

// ── 3. ToolExecutionComponent 渲染（0.82.1 位置参数签名）──
try {
  const toolRow = new ToolExecutionComponent(
    "bash",
    "spike-1",
    { command: "echo hi" },
    undefined,
    undefined,
    tui,
    process.cwd(),
  );
  tui.addChild(toolRow);
  tui.requestRender();
  await new Promise((r) => setTimeout(r, 80));
  check("ToolExecutionComponent renders without throwing", term.output.length > 0);
} catch (err) {
  check("ToolExecutionComponent renders without throwing", false, String(err));
}

tui.stop();

// ── 4. 键盘序列归一化 ──
const keyCases = [
  ["\x1b[A", Key.up],
  ["\x1b[B", Key.down],
  ["\x1b[1;5A", Key.ctrl("up")],
  ["\r", Key.enter],
  ["\x1b", Key.escape],
];
for (const [seq, key] of keyCases) {
  check(`matchesKey(${JSON.stringify(seq)})`, matchesKey(seq, key));
}

console.log(failures === 0 ? "SPIKE PASSED" : `SPIKE FAILED (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
