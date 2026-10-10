/**
 * 记一笔快捷键的显示文案。
 *
 * 与 `useIdeaCaptureShortcut` 里的 `IDEA_CAPTURE_SHORTCUT` 是同一条信息的两个面：
 * 那里是键位常量，这里是给人看的标签。三条文案（浮层提示、空态、标题栏气泡）
 * 都从这一个函数取，换键位时不会漏掉某处还写着旧键。
 */
export function captureShortcutLabel(platform: string | undefined): string {
  return platform === "darwin" ? "⌘⇧K" : "Ctrl+Shift+K";
}
