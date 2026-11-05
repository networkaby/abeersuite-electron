// Item counts for a parent/child master tree (product groups, collections).
// Each row carries `_count.products` = products directly in it; a parent's
// total adds every descendant's own count. `subtreeIds` is the row plus all its
// descendants — what the Items link filters the Products list by.

type TreeRow = { id: number; parentId: number | null; _count?: { products: number } };

export function treeItemTotals(rows: TreeRow[]): Map<number, number> {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const total = new Map(rows.map((r) => [r.id, r._count?.products ?? 0]));
    for (const r of rows) {
        const own = r._count?.products ?? 0;
        const seen = new Set<number>([r.id]);
        let pid = r.parentId;
        while (pid != null && !seen.has(pid) && byId.has(pid)) {
            seen.add(pid);
            total.set(pid, (total.get(pid) ?? 0) + own);
            pid = byId.get(pid)?.parentId ?? null;
        }
    }
    return total;
}

export function subtreeIds(rows: TreeRow[], id: number): number[] {
    const out = [id];
    for (let i = 0; i < out.length; i++) {
        for (const r of rows) if (r.parentId === out[i] && !out.includes(r.id)) out.push(r.id);
    }
    return out;
}
