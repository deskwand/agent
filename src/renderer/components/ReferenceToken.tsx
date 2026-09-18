// 行内引用 token 的唯一渲染来源。
//
// 不变量（设计文档 §4.1）：三类共用同一个语义色与同一套图标尺寸；
// 「有下划线的可点击，没有下划线的不可点击」—— 用户不需要记哪个 token 能点。
import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import {
  REFERENCE_TOKEN_ICON_MARKUP,
  type ReferenceTokenKind,
} from "./reference-token-visuals";

export interface ReferenceTokenProps {
  kind: ReferenceTokenKind;
  /** 已经决定好的显示文本：技能 = 纯名称，命令 = 含斜杠，文件 = 路径原文 */
  label: string;
  /** 空/缺省不渲染气泡锚点 */
  tooltip?: string;
  /** 只有传了才渲染成可点击的按钮，并带上下划线 */
  onClick?: () => void;
}

/**
 * 必须与 utils/editor-content.ts 的 TOKEN_CLASS 保持一致（同一套外观，输入框与气泡共用）。
 * 不要改回 inline-flex —— 容器的基线会取自首个 flex item（svg）的底边，token 会被抬高约 2px。
 */
const BASE_CLASS = "font-medium text-mention";

export function ReferenceToken({
  kind,
  label,
  tooltip,
  onClick,
}: ReferenceTokenProps) {
  const inner: ReactNode = (
    <>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="reference-token-icon mr-1 h-3.5 w-3.5"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: REFERENCE_TOKEN_ICON_MARKUP[kind] }}
      />
      <span className={onClick ? "underline underline-offset-2" : undefined}>
        {label}
      </span>
    </>
  );

  const body = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${BASE_CLASS} break-all text-left`}
    >
      {inner}
    </button>
  ) : (
    <span className={`${BASE_CLASS} whitespace-nowrap`}>{inner}</span>
  );

  return tooltip ? <Tooltip label={tooltip}>{body}</Tooltip> : body;
}
