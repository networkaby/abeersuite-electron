// The ONE home for parent/child master trees — product groups, collections
// (InvCategory) and any other parented list. Every dropdown, filter, master
// table and item count reads its order, labels and subtrees from here, so the
// tree looks and behaves the same on every screen.

export type TreeNodeRow = { id: number; parentId?: number | null; name?: string; code?: string; label?: string };

/** The visible name of a row: `name`, else "code label", else "#id". */
export function treeRowName(o: TreeNodeRow): string {
    if (o.name) return o.name;
    const composed = `${o.code ?? ""} ${o.label ?? ""}`.trim();
    return composed || `#${o.id}`;
}

/**
 * Walk a parented list depth-first: parents above their children, siblings
 * A–Z. Each row comes back with its resolved `name` and `depth`; every other
 * field (parentId, isActive…) is kept. Orphans (parent not in the list —
 * usually a deactivated parent) come last at depth 0 so they stay pickable.
 */
export function flattenTree<T extends TreeNodeRow>(rows: T[]): (T & { name: string; depth: number })[] {
    const byParent = new Map<number | null, T[]>();
    for (const r of rows) {
        const pid = r.parentId ?? null;
        const arr = byParent.get(pid) ?? [];
        arr.push(r);
        byParent.set(pid, arr);
    }
    const out: (T & { name: string; depth: number })[] = [];
    const seen = new Set<number>();
    const walk = (parent: number | null, depth: number) => {
        const kids = (byParent.get(parent) ?? []).slice().sort((a, b) => treeRowName(a).localeCompare(treeRowName(b)));
        for (const k of kids) {
            if (seen.has(k.id)) continue;
            seen.add(k.id);
            out.push({ ...k, name: treeRowName(k), depth });
            walk(k.id, depth + 1);
        }
    };
    walk(null, 0);
    for (const r of rows) if (!seen.has(r.id)) out.push({ ...r, name: treeRowName(r), depth: 0 });
    return out;
}

/** Indented label: one "-" per level ("Keyboard", "-Wireless", "--Mini"). */
export function treeLabel(row: { name: string; depth: number }): string {
    return row.depth === 0 ? row.name : `${"-".repeat(row.depth)}${row.name}`;
}

/** Ready-made options for SearchableSelect / MultiSearchableSelect. */
export function treeSelectOptions(rows: TreeNodeRow[]): { value: number; label: string; leaf: string; searchText: string }[] {
    return flattenTree(rows).map((r) => ({ value: r.id, label: treeLabel(r), leaf: r.name, searchText: r.name }));
}

/** The row plus every descendant — picking a parent also matches its children. */
export function subtreeIds(rows: TreeNodeRow[], id: number): number[] {
    const out = [id];
    for (let i = 0; i < out.length; i++) {
        for (const r of rows) if (r.parentId === out[i] && !out.includes(r.id)) out.push(r.id);
    }
    return out;
}

/** Item counts per node: own products + every descendant's (`_count.products`). */
export function treeItemTotals(rows: (TreeNodeRow & { _count?: { products: number } })[]): Map<number, number> {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const total = new Map(rows.map((r) => [r.id, r._count?.products ?? 0]));
    for (const r of rows) {
        const own = r._count?.products ?? 0;
        const seen = new Set<number>([r.id]);
        let pid = r.parentId ?? null;
        while (pid != null && !seen.has(pid) && byId.has(pid)) {
            seen.add(pid);
            total.set(pid, (total.get(pid) ?? 0) + own);
            pid = byId.get(pid)?.parentId ?? null;
        }
    }
    return total;
}
