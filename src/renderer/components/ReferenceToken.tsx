// 行内引用 token 的唯一渲染来源。
//
// 不变量（设计文档 §4.1）：三类共用同一个语义色与同一套图标尺寸；
// 「有下划线的可点击，没有下划线的不可点击」—— 用户不需要记哪个 token 能点。
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import {
  REFERENCE_TOKEN_ICON_MARKUP,
  type ReferenceTokenKind,
} from "./reference-token-visuals";
import { Button } from "./app-button";

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
    <Button variant="ghost"
      type="button"
      onClick={onClick}
      className={`${BASE_CLASS} break-all text-left`}
    >
      {inner}
    </Button>
  ) : (
    <span className={`${BASE_CLASS} whitespace-nowrap`}>{inner}</span>
  );

  // 空 tooltip 必须保持「只渲染 children、不产生气泡」的语义（老 Tooltip 的
  // `if (!hasLabel) return <>{children}</>`）—— 不要渲染一个空气泡，那会让
  // aria-describedby 指向不存在的 id。
  return tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      {/* side 必须显式给 bottom：vendored TooltipContent 的 Radix 默认是 top，
          而老 Tooltip 的 placement 默认是下方 —— 不写会把气泡挪到按钮上方。 */}
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    body
  );
}
