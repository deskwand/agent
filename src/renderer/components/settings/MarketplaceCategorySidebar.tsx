import { useTranslation } from "react-i18next";

export interface MarketplaceCategorySidebarProps {
  categories: Array<{ key: string; name: string }>;
  selectedCategory: string | null;
  onSelect: (key: string | null) => void;
}

export function MarketplaceCategorySidebar({
  categories,
  selectedCategory,
  onSelect,
}: MarketplaceCategorySidebarProps) {
  const { t } = useTranslation();

  if (categories.length === 0) return null;

  return (
    <div className="w-[160px] border-r border-border-primary pr-3 py-1 shrink-0">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-2">
        {t("skillMarket.categories")}
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
            selectedCategory === null
              ? "bg-accent/10 text-accent font-medium"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          }`}
        >
          {t("skillMarket.allCategories")}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => onSelect(cat.key)}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors truncate ${
              selectedCategory === cat.key
                ? "bg-accent/10 text-accent font-medium"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  );
}
