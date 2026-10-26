import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * 概览里每个区块的外壳：标题、折叠、右侧动作。
 * 头部是「折叠按钮 + 动作槽」两段，动作槽允许放按钮（不能把 button 套进 button）。
 */
export function OverviewSection({
  titleKey,
  action,
  defaultOpen = true,
  children,
}: {
  titleKey: string;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-border/20">
      <div className="flex w-full items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground">
            {t(titleKey)}
          </span>
        </button>
        {action}
      </div>
      {open && <div className="space-y-1 px-2 pb-2">{children}</div>}
    </section>
  );
}
