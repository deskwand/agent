import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import i18n from "../i18n/config";
import { Button } from "./app-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Root-level ErrorBoundary that catches any uncaught render errors in the
 * React tree and shows a user-friendly fallback page instead of a white screen.
 *
 * Uses i18n directly (not the useTranslation hook) because class components
 * cannot use React hooks.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught render error:", error, info);
  }

  /** Reset the boundary so the subtree can attempt re-rendering. */
  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = (key: string) => i18n.t(key);

    return (
      <div className="h-full w-full min-h-0 flex flex-col items-center justify-center bg-background px-6 py-10">
        <div className="max-w-md w-full space-y-6 text-center">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="w-8 h-8" />
            </div>
          </div>

          {/* Heading & description */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">
              {t("errorBoundary.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("errorBoundary.description")}
            </p>
          </div>

          {/* Error detail (collapsed, non-critical) */}
          {this.state.error && (
            <Collapsible className="text-left rounded-xl border border-border/40 bg-muted px-4 py-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost"
                  type="button"
                  className="cursor-pointer text-xs text-muted-foreground select-none h-auto px-0 hover:bg-transparent hover:text-current"
                >
                  {t("errorBoundary.details")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 text-xs text-destructive/80 whitespace-pre-wrap break-all font-mono">
                  {this.state.error.message}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Retry button */}
          {/* `.btn .btn-primary` → shadcn `Button`（计划 11 · Task 4）。
              变体表达不了的差异保留成自定义类：
              · `size="lg"` 只取高度（h-10 = 2.5rem = 原 py-2.5 + 行高的实际盒高），
                `px-5` / `rounded-2xl` 覆盖掉 lg 的 px-8 / rounded-md；
              · `shadow-none` —— `.btn-primary` 没有投影，default 变体自带 `shadow`；
              · `hover:bg-primary/90` —— 保住每套主题各自的 hover 色
                （default 变体的 `hover:bg-primary/90` 是透明度混色，会盖掉主题色）；
              · `active:scale-[0.97]` + transition 组 —— 保住 .btn 的按压反馈。
                ⚠️ 原曲线 cubic-bezier(0.34, 1.56, 0.64, 1) 没保住：本仓 tailwind 配置下
                `ease-[cubic-bezier(…)]` 被判定 ambiguous、**一条规则都不生成**（探针实测），
                要还原得动 tailwind.config.js —— 不属于本任务。 */}
          <Button
            type="button"
            variant="default"
            size="lg"
            onClick={this.handleReset}
            className="px-5 rounded-2xl shadow-none hover:bg-primary/90 active:scale-[0.97] transition-[transform,background-color,color]"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t("errorBoundary.retry")}</span>
          </Button>
        </div>
      </div>
    );
  }
}
