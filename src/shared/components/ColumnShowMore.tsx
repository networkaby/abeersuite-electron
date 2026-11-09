"use client";

/** "Show more" at the foot of a capped board column — see useColumnCap. */
export default function ColumnShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
    if (hidden <= 0) return null;
    return (
        <button
            type="button"
            onClick={onClick}
            className="rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground"
        >
            Show more ({hidden})
        </button>
    );
}
