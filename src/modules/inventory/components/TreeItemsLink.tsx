import Link from "next/link";
import { subtreeIds, treeItemTotals } from "@/shared/lib/tree";

type TreeRow = { id: number; parentId: number | null; _count?: { products: number } };

/**
 * The Items count on a master tree page (product groups, collections). A count
 * above 0 links to Products filtered by this row and all its descendants —
 * `param` is the Products query key (`groups` / `collections`).
 */
export function TreeItemsLink({ rows, totals, id, param }: {
    rows: TreeRow[];
    totals: ReturnType<typeof treeItemTotals>;
    id: number;
    param: "groups" | "collections";
}) {
    const n = totals.get(id) ?? 0;
    if (n === 0) return <span className="text-muted-foreground">0</span>;
    return (
        <Link
            href={`/office/inventory/products?${param}=${subtreeIds(rows, id).join(",")}`}
            className="text-primary underline-offset-2 hover:underline"
            title="Open these products"
        >
            {n}
        </Link>
    );
}
