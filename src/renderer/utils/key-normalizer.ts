export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const ARROW_SEQ: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowLeft: "\x1b[D",
  ArrowRight: "\x1b[C",
};

const CTRL_ARROW_SEQ: Record<string, string> = {
  ArrowUp: "\x1b[1;5A",
  ArrowDown: "\x1b[1;5B",
  ArrowLeft: "\x1b[1;5D",
  ArrowRight: "\x1b[1;5C",
};

/** DOM KeyboardEvent → 终端输入序列；null = 忽略（纯修饰键等）。 */
export function normalizeKeyEvent(event: KeyEventLike): string | null {
  const { key, ctrlKey, altKey, shiftKey } = event;
  if (
    key === "Control" ||
    key === "Shift" ||
    key === "Alt" ||
    key === "Meta"
  ) {
    return null;
  }
  if (key === "Enter") return "\r";
  if (key === "Escape") return "\x1b";
  if (key === "Tab") return shiftKey ? "\x1b[Z" : "\t";
  if (key === "Backspace") return "\x7f";
  if (key === "Delete") return "\x1b[3~";
  if (key === "Home") return "\x1b[H";
  if (key === "End") return "\x1b[F";
  if (key === "PageUp") return "\x1b[5~";
  if (key === "PageDown") return "\x1b[6~";
  if (ctrlKey && key.startsWith("Arrow")) return CTRL_ARROW_SEQ[key] ?? null;
  if (key.startsWith("Arrow")) return ARROW_SEQ[key] ?? null;
  if (ctrlKey && key.length === 1) {
    const code = key.toLowerCase().charCodeAt(0) - 96;
    if (code >= 1 && code <= 26) return String.fromCharCode(code);
  }
  if (ctrlKey && key === "[") return "\x1b[";
  if (altKey && key.length === 1) return `\x1b${key}`;
  if (key.length === 1) return key;
  return null;
}
