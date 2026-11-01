import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "./ui/input";
import { Button } from "./app-button";

// ---------------------------------------------------------------------------
// TimePicker — single-column scrollable list, Feishu Calendar style
// ---------------------------------------------------------------------------

const TIMES_30MIN: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

export function TimePicker({
  selected,
  onChange,
  single = false,
  addTimeLabel,
}: {
  selected: string[];
  onChange: (v: string[] | ((prev: string[]) => string[])) => void;
  single?: boolean;
  addTimeLabel?: string;
}) {
  const { t } = useTranslation();
  const [customInput, setCustomInput] = useState("");

  const remove = (time: string) => {
    onChange((prev) => prev.filter((t) => t !== time));
  };

  const toggle = (time: string) => {
    if (single) {
      onChange([time]);
    } else {
      onChange((prev) => {
        const next = prev.includes(time)
          ? prev.filter((t) => t !== time)
          : [...prev, time];
        return next.sort();
      });
    }
  };

  const addCustom = () => {
    const raw = customInput.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(raw)) return;
    if (single) {
      onChange([raw]);
      setCustomInput("");
      return;
    }
    onChange((prev) => {
      if (prev.includes(raw)) return prev;
      return [...prev, raw].sort();
    });
    setCustomInput("");
  };

  const label = addTimeLabel ?? t("schedule.addTime");

  return (
    <div className="space-y-2">
      {/* Chips row — selected times feedback */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-primary/10 text-primary-text"
            >
              {t}
              <Button
                variant="ghost"
                type="button"
                size="iconSm"
                onClick={() => remove(t)}
                className="hover:text-destructive transition-colors leading-none"
              >
                ×
              </Button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <Input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
          placeholder="HH:mm"
          maxLength={5}
          className="h-auto flex-1 rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
        <Button
          variant="ghost"
          type="button"
          onClick={addCustom}
          className="px-3 py-1 text-xs font-medium rounded-md bg-muted border border-border text-muted-foreground hover:bg-selected-surface transition-colors h-auto"
        >
          {label}
        </Button>
      </div>
      <div className="h-60 overflow-y-auto bg-muted border border-border rounded-lg">
        {TIMES_30MIN.map((time) => {
          const isSelected = selected.includes(time);
          return (
            <Button
              variant="ghost"
              key={time}
              type="button"
              onClick={() => toggle(time)}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-hover-surface ${isSelected ? "text-primary-text bg-primary/5" : "text-muted-foreground"}`}
            >
              <span>{time}</span>
              {isSelected && (
                <span className="text-primary-text font-bold">✓</span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
