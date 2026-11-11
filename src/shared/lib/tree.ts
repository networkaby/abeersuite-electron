// The ONE home for parent/child trees — product groups, collections, account
// groups, the org chart, any parented list. Every dropdown, filter, master table,
// report and item count reads its order, labels and subtrees from here, so a
// tree looks and behaves the same on every screen. Pure: safe on server and client.

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

/** parent id → its direct children ids. Build once, then ask `subtreeIds` many times. */
export function childrenMap(rows: { id: number; parentId?: number | null }[]): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (const r of rows) {
        if (r.parentId == null) continue;
        const arr = out.get(r.parentId);
        if (arr) arr.push(r.id);
        else out.set(r.parentId, [r.id]);
    }
    return out;
}

/** The row plus every descendant — picking a parent also matches its children.
 *  Pass the rows, or a `childrenMap` when asking for many ids. Safe on a loop. */
export function subtreeIds(rows: { id: number; parentId?: number | null }[] | Map<number, number[]>, id: number): number[] {
    const kids = rows instanceof Map ? rows : childrenMap(rows);
    const out = [id];
    const seen = new Set(out);
    for (let i = 0; i < out.length; i++) {
        for (const k of kids.get(out[i]) ?? []) {
            if (!seen.has(k)) { seen.add(k); out.push(k); }
        }
    }
    return out;
}

/** Ancestors nearest-first: [parent, grandparent, …] (not the id itself). Safe on a loop. */
export function ancestorIds(id: number, parentOf: (id: number) => number | null | undefined): number[] {
    const out: number[] = [];
    const seen = new Set<number>([id]);
    for (let cur = parentOf(id) ?? null; cur != null && !seen.has(cur); cur = parentOf(cur) ?? null) {
        seen.add(cur);
        out.push(cur);
    }
    return out;
}

export type Nested<T> = T & { children: Nested<T>[] };

/**
 * Nest a flat parented list: each row gets `children`. A row whose parent is
 * not in the list becomes a root. Siblings sort by name unless `compare` is
 * given (`null` keeps the list's own order).
 */
export function buildNestedTree<T extends { id: number }>(
    rows: T[],
    parentOf: (r: T) => number | null | undefined = (r) => (r as { parentId?: number | null }).parentId,
    compare: ((a: T, b: T) => number) | null = (a, b) => treeRowName(a as TreeNodeRow).localeCompare(treeRowName(b as TreeNodeRow)),
): Nested<T>[] {
    const byId = new Map<number, Nested<T>>();
    for (const r of rows) byId.set(r.id, { ...r, children: [] });
    const roots: Nested<T>[] = [];
    for (const r of rows) {
        const node = byId.get(r.id)!;
        const pid = parentOf(r);
        const parent = pid != null && pid !== r.id ? byId.get(pid) : undefined;
        (parent ? parent.children : roots).push(node);
    }
    if (compare) {
        const sortRec = (nodes: Nested<T>[]) => { nodes.sort(compare); nodes.forEach((n) => sortRec(n.children)); };
        sortRec(roots);
    }
    return roots;
}

/** A nested tree back to rows with depth, in its own order (for an indented <select>). */
export function flattenNested<N extends { children: N[] }>(nodes: N[], depth = 0): (N & { depth: number })[] {
    return nodes.flatMap((n) => [{ ...n, depth }, ...flattenNested(n.children, depth + 1)]);
}

/** Every id in a nested node: itself + all below. */
export function nestedIds(node: { id: number; children: { id: number; children: unknown[] }[] }): number[] {
    return [node.id, ...node.children.flatMap((c) => nestedIds(c as typeof node))];
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
