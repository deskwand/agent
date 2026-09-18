// token 图标的**单一来源**。
//
// 为什么要抄一份语义图标的路径数据而不是直接用 lucide 的 React 组件：
// 输入框里的 token 是直接写进 contenteditable 的 DOM 节点（非受控，不经 React），
// 气泡里的 token 走 React —— 两处必须像素一致，共用同一份标记字符串才是真单一来源。
// 升级 lucide 时两处一起变；不一致会让同一个技能在输入框和气泡里长得不一样。
//
// 路径数据取自 lucide-react v1.8.0（ISC）的 Sparkles / Zap / FileText。

export type ReferenceTokenKind = "skill" | "command" | "file";

/** 对应 lucide Sparkles / Zap / FileText 的 <svg> 内部标记。 */
export const REFERENCE_TOKEN_ICON_MARKUP: Record<ReferenceTokenKind, string> = {
  skill:
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  command:
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
};
