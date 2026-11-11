import { useMemo, useState } from "react";
import { flattenTree } from "@/shared/lib/tree";

export type TreeRowMeta<T> = { row: T; depth: number; hasChildren: boolean };

/**
 * Turns a flat parented list into a collapsible, hierarchy-ordered view.
 *
 * Ordering (parent → child, alphabetical within a level) is delegated to the
 * shared `flattenTree` helper so master tables and the parent-picker dropdowns
 * stay in sync. On top of that we track a set of collapsed node ids and drop
 * every descendant of a collapsed node from the visible list.
 *
 * Generic over any row that carries a numeric `id`, a `parentId`, and a `name`
 * (the last one is what `flattenTree` sorts on).
 */
export function useCollapsibleTree<
    T extends { id: number; parentId: number | null; name: string },
>(rows: T[]) {
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

    const { visible, parentIds } = useMemo(() => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        const childCount = new Map<number, number>();
        for (const r of rows) {
            if (r.parentId != null) childCount.set(r.parentId, (childCount.get(r.parentId) ?? 0) + 1);
        }

        const ordered = flattenTree(rows)
            .map((n) => ({ row: byId.get(n.id), depth: n.depth }))
            .filter((x): x is { row: T; depth: number } => Boolean(x.row));

        const out: TreeRowMeta<T>[] = [];
        // Depth of the shallowest collapsed ancestor currently hiding rows; null
        // when nothing is hiding. Any row deeper than this is skipped until we
        // climb back to that depth or above.
        let hideBelow: number | null = null;
        for (const { row, depth } of ordered) {
            if (hideBelow != null) {
                if (depth > hideBelow) continue;
                hideBelow = null;
            }
            const hasChildren = childCount.has(row.id);
            out.push({ row, depth, hasChildren });
            if (hasChildren && collapsed.has(row.id)) hideBelow = depth;
        }

        return { visible: out, parentIds: new Set(childCount.keys()) };
    }, [rows, collapsed]);

    const toggle = (id: number) =>
        setCollapsed((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const expandAll = () => setCollapsed(new Set());
    const collapseAll = () => setCollapsed(new Set(parentIds));

    return { visible, collapsed, toggle, expandAll, collapseAll, hasTree: parentIds.size > 0 };
}
