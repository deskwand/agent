import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from "@floating-ui/react";

interface TooltipProps {
  /**
   * 气泡文案。调用方负责 i18n。
   * 空字符串表示“此刻没有提示”——迁移前有按钮在特定状态下把 title 设为 `""`，
   * 空 label 时直接返回 children，不渲染气泡。这是真实存在的调用形态。
   */
  label: string;
  children: ReactNode;
}

/**
 * 操作提示气泡。
 *
 * 定位用 @floating-ui/react 的 autoUpdate + flip + shift；可见性由 useHover /
 * useFocus 的 state 驱动。组件不产生浏览器原生 title 气泡。
 *
 * 气泡走 createPortal 挂到 document.body，并且**不能**用 strategy: "fixed"：
 * 祖先带 transform 时（本项目的 sidebar-disclosure-motion 会动态写 transform），
 * fixed 的包含块会变成那个祖先，而 floating-ui 给的是视口坐标 —— 实测水平偏 37px。
 * 挂到 body 之后 offsetParent 就是 body，默认的 absolute 策略两种场景都对；
 * portal 同时解决了祖先 overflow: hidden 裁剪气泡的问题。
 *
 * 为什么不直接用 CSS Anchor Positioning（设计文档 §4.2 的首选方案）：
 * 经 Electron 35（Chromium 134）实测，`position-area: bottom` 把气泡居中在锚点的
 * inline 范围内，而该范围只有锚点宽（图标按钮 28px）；气泡比锚点宽时无论
 * `flip-inline` 还是 `@position-try` 换 region 都无法退回窗口内——
 * 前者右溢 46px，后者虽不溢出但会把气泡扔到窗口另一端 800+px 处。
 * CSS 锚点定位没有 shift/clamp 语义，所以改用 floating-ui。
 *
 * 有意不在这里注入 aria-label：组件无法判断子元素是否已有可访问文本，
 * 对“按钮内已有可见文字”的情况注入会覆盖可见文字（违反 WCAG 2.5.3）。
 * 可访问名由调用方负责。
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const hasLabel = Boolean(label);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    enabled: hasLabel,
    delay: { open: 400, close: 0 },
  });
  const focus = useFocus(context, { enabled: hasLabel });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
  ]);

  // 所有 hook 必须在此之前调用（Rules of Hooks）。
  if (!hasLabel) return <>{children}</>;

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        className="tt-anchor"
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              ref={refs.setFloating}
              role="tooltip"
              className="tt-bubble"
              style={floatingStyles}
              {...getFloatingProps()}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
