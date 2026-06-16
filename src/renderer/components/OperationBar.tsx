import { Loader2, X, Check } from "lucide-react";

export interface Operation {
  id: string;
  label: string;
  onCancel?: () => void;
  done?: boolean;
}

interface OperationBarProps {
  operations: Operation[];
}

export function OperationBar({ operations }: OperationBarProps) {
  const visible = operations.length > 0;

  return (
    <div
      className={`overflow-hidden transition-all duration-300 ease-in-out ${
        visible ? "max-h-10 opacity-100" : "max-h-0 opacity-0"
      }`}
    >
      <div className="flex items-center justify-between px-5 py-1.5 text-sm bg-accent/10 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          {operations[0]?.done ? (
            <Check size={14} className="text-green-500 shrink-0" />
          ) : (
            <Loader2 size={14} className="animate-spin text-accent shrink-0" />
          )}
          <span className="truncate text-text-secondary">
            {operations[0]?.label}
          </span>
        </div>
        {operations[0]?.onCancel && !operations[0]?.done && (
          <button
            type="button"
            onClick={operations[0].onCancel}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary shrink-0"
            title="Cancel"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
