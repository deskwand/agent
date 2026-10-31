// 工具输出的限高容器：默认限高 + 内部滚动，用户显式点「显示全部输出」才铺开全文。
//
// 为什么不直接铺开：bash 输出上限 10MB、web_search 结果 20000 字符，真遇到几十万行时
// 一次性铺开会把主线程打死。所以默认仍然限高，但把「我要看全文」做成一次显式点击。
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../app-button";

interface OutputClampProps {
  /** 限高态的高度上限（px）。默认 300。 */
  maxHeight?: number;
  children: ReactNode;
}

/**
 * 子级铺开时把祖先也铺开：工具分组列表自己带一层 400px 钳制，组内单个工具铺开后
 * 仍然被外层裁着，用户点完只多看到一小截、会以为按钮没用。
 */
const ExpandAncestorsContext = createContext<(() => void) | null>(null);

export function OutputClamp({ maxHeight = 300, children }: OutputClampProps) {
  const { t } = useTranslation();
  const expandAncestors = useContext(ExpandAncestorsContext);
  const [fullyExpanded, setFullyExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // 只在限高态测量：铺开后 clientHeight 等于全文高度，量出来必然「不溢出」，
  // 「收起输出」按钮会自己消失。
  useLayoutEffect(() => {
    if (fullyExpanded) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const measure = () => {
      // 量不出高度（jsdom 没有布局）：只有在这种情况下才按「已溢出」处理 —— 真实浏览器里
      // 0/0 意味着内容为空或祖先 display:none，不该弹一个点了没反应的按钮；后者在显示
      // 出来时由 ResizeObserver 自己纠正。
      if (scrollEl.clientHeight === 0 && scrollEl.scrollHeight === 0) {
        setOverflowing(typeof ResizeObserver === "undefined");
        return;
      }
      setOverflowing(scrollEl.scrollHeight > scrollEl.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    // 观察内容节点：流式输出变长时，尺寸变化的是它，不是被限高的外层。
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [fullyExpanded]);

  const toggle = () => {
    const next = !fullyExpanded;
    setFullyExpanded(next);
    if (next) expandAncestors?.();
  };

  // 交给更深一层的 clamp：它铺开时连同本层一起铺开。
  const expandChain = () => {
    setFullyExpanded(true);
    expandAncestors?.();
  };

  return (
    <ExpandAncestorsContext.Provider value={expandChain}>
      <div>
        <div
          ref={scrollRef}
          data-output-clamp={fullyExpanded ? "full" : "clamped"}
          className={fullyExpanded ? undefined : "overflow-y-auto rounded-lg"}
          style={fullyExpanded ? undefined : { maxHeight }}
        >
          <div ref={contentRef}>{children}</div>
        </div>
        {overflowing && (
          <div className="mt-1 flex justify-end">
            <Button
              variant="ghost"
              type="button"
              size="xs"
              className="text-muted-foreground hover:text-current"
              onClick={toggle}
            >
              {fullyExpanded
                ? t("tool.collapseOutput")
                : t("tool.showFullOutput")}
            </Button>
          </div>
        )}
      </div>
    </ExpandAncestorsContext.Provider>
  );
}
