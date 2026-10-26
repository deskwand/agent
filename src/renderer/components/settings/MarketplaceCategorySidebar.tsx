import { useTranslation } from "react-i18next";
import { Button } from "../app-button";

export interface MarketplaceCategorySidebarProps {
  categories: Array<{ key: string; name: string }>;
  selectedCategory: string | null;
  loading?: boolean;
  onSelect: (key: string | null) => void;
}

export function MarketplaceCategorySidebar({
  categories,
  selectedCategory,
  loading,
  onSelect,
}: MarketplaceCategorySidebarProps) {
  const { t } = useTranslation();

  if (categories.length === 0 && !loading) return null;

  return (
    <div className="w-[160px] border-r border-border pr-3 py-1 shrink-0">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
        {t("skillMarket.categories")}
      </div>
      <div className="flex flex-col gap-0.5">
        <Button variant="ghost"
          onClick={() => onSelect(null)}
          className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
            selectedCategory === null
              ? "bg-primary/10 text-primary-text font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-hover-surface"
          }`}
        >
          {t("skillMarket.allCategories")}
        </Button>
        {loading && categories.length === 0
          ? Array.from({ length: 5 }, (_, i) => (
              <div
                key={`cat-sk-${i}`}
                className="h-7 mx-2 rounded-md bg-muted animate-pulse"
              />
            ))
          : categories.map((cat) => (
              <Button variant="ghost"
                key={cat.key}
                onClick={() => onSelect(cat.key)}
                className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors truncate ${
                  selectedCategory === cat.key
                    ? "bg-primary/10 text-primary-text font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-hover-surface"
                }`}
              >
                {cat.name}
              </Button>
            ))}
      </div>
    </div>
  );
}
