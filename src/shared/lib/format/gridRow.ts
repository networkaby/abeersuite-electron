// Row painting for long data grids — the "which line am I on" problem.
//
// Every colour here is OPAQUE: it mixes the tint into var(--background)
// instead of layering a translucent wash. Two reasons:
//   1. frozen (sticky) columns use `bg-inherit`, and a see-through row colour
//      lets the horizontally scrolled cells ghost through them;
//   2. stacked translucent states (zebra + hover + selected) muddy into an
//      unreadable grey.
// Because the mix resolves against var(--background), light and dark mode are
// both handled without a single `dark:` variant.
//
// Works with the shadcn <TableRow> and with a plain <tr> — it is only a class
// string. Pair with useActiveRow() for the active-line highlight.

/// Row backgrounds, softest → strongest.
export const GRID_ROW_BG = {
    plain: "bg-background",
    zebra: "bg-[color-mix(in_oklab,var(--muted)_55%,var(--background))]",
    inactive: "bg-[color-mix(in_oklab,var(--muted)_85%,var(--background))]",
    active: "bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))]",
    selected: "bg-[color-mix(in_oklab,#0ea5e9_14%,var(--background))]",
    dirty: "bg-[color-mix(in_oklab,#f59e0b_18%,var(--background))]",
} as const;

/// Colour bar down the first cell — the at-a-glance state signal. Kept on the
/// first cell (not the row) because a box-shadow on <tr> is unreliable.
export const GRID_ROW_BAR = {
    none: "",
    active: "[&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]",
    selected: "[&>td:first-child]:shadow-[inset_3px_0_0_#0ea5e9]",
    dirty: "[&>td:first-child]:shadow-[inset_3px_0_0_#f59e0b]",
    inactive: "[&>td:first-child]:shadow-[inset_3px_0_0_var(--muted-foreground)]",
} as const;

/// Hover strong enough to actually see on a dense grid. Declared here so the
/// caller's class list carries it and tailwind-merge drops the primitive's
/// weaker one.
export const GRID_ROW_HOVER =
    "hover:bg-[color-mix(in_oklab,var(--primary)_16%,var(--background))]";

export type GridRowState = {
    /// Has unsaved edits.
    dirty?: boolean;
    /// Domain-level "this line needs you" — low stock, overdue, blocked.
    /// Shares the amber of `dirty` on purpose: one colour, one meaning.
    attention?: boolean;
    /// Ticked for a bulk action.
    selected?: boolean;
    /// The line the operator is on (click or focus). See useActiveRow.
    active?: boolean;
    /// Row is disabled/archived data — greyed, still readable.
    inactive?: boolean;
    /// Zebra stripe — pass `index % 2 === 1`.
    odd?: boolean;
};

/// One class string for a grid row. Precedence, strongest first:
/// dirty/attention > selected > active > inactive > zebra.
export function gridRowClass(s: GridRowState): string {
    const amber = s.dirty || s.attention;
    const bg = amber ? GRID_ROW_BG.dirty
        : s.selected ? GRID_ROW_BG.selected
        : s.active ? GRID_ROW_BG.active
        : s.inactive ? GRID_ROW_BG.inactive
        : s.odd ? GRID_ROW_BG.zebra
        : GRID_ROW_BG.plain;
    const bar = amber ? GRID_ROW_BAR.dirty
        : s.selected ? GRID_ROW_BAR.selected
        : s.active ? GRID_ROW_BAR.active
        : s.inactive ? GRID_ROW_BAR.inactive
        : GRID_ROW_BAR.none;
    const ring = s.active ? "outline outline-1 -outline-offset-1 outline-primary/40" : "";
    return [bg, bar, GRID_ROW_HOVER, ring].filter(Boolean).join(" ");
}

/// Frozen-column classes. The cell inherits the row colour so the freeze keeps
/// the row's state tint; give it a `left` offset via inline style.
export const GRID_FROZEN_CELL = "sticky z-10 bg-inherit";
export const GRID_FROZEN_HEAD = "sticky z-30 bg-inherit";
/// Edge of the last frozen column — hairline + soft shadow so the freeze reads.
export const GRID_FROZEN_EDGE =
    "shadow-[1px_0_0_var(--border),6px_0_8px_-6px_rgba(0,0,0,0.18)]";
