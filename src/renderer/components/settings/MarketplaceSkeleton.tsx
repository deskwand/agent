interface MarketplaceSkeletonProps {
  viewMode: "cards" | "list";
  count?: number;
}

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border-primary p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="rounded-lg w-12 h-12 bg-surface-muted shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 bg-surface-muted rounded w-24" />
          <div className="h-3 bg-surface-muted rounded w-full" />
          <div className="h-3 bg-surface-muted rounded w-3/4" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <div className="h-6 bg-surface-muted rounded w-14" />
        <div className="h-6 bg-surface-muted rounded w-14" />
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="rounded-lg border border-border-primary p-2.5 animate-pulse">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="rounded-lg w-9 h-9 bg-surface-muted shrink-0" />
          <div className="min-w-0 space-y-1.5 flex-1">
            <div className="h-4 bg-surface-muted rounded w-28" />
            <div className="h-3 bg-surface-muted rounded w-48" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="h-5 bg-surface-muted rounded w-12" />
          <div className="h-5 bg-surface-muted rounded w-12" />
        </div>
      </div>
    </div>
  );
}

export function MarketplaceSkeleton({
  viewMode,
  count = 6,
}: MarketplaceSkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <div
      className={
        viewMode === "cards"
          ? "grid grid-cols-1 md:grid-cols-2 gap-3"
          : "space-y-2"
      }
    >
      {items.map((i) =>
        viewMode === "cards" ? (
          <CardSkeleton key={i} />
        ) : (
          <ListSkeleton key={i} />
        ),
      )}
    </div>
  );
}
