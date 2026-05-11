import { Loader2 } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * Loading state row for shadcn `<Table>`. Drops into `<TableBody>` while data is loading.
 *
 *   {loading && <TableLoadingRow colSpan={6} />}
 */
export function TableLoadingRow({ colSpan, message = "Loading…" }: { colSpan: number; message?: string }) {
    return (
        <TableRow>
            <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {message}
                </span>
            </TableCell>
        </TableRow>
    );
}

/**
 * Empty state row for shadcn `<Table>`. Shown when the query succeeded but returned no rows.
 *
 *   {!loading && rows.length === 0 && <TableEmptyRow colSpan={6} />}
 */
export function TableEmptyRow({ colSpan, message = "No items" }: { colSpan: number; message?: string }) {
    return (
        <TableRow>
            <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
                {message}
            </TableCell>
        </TableRow>
    );
}

/**
 * Error state row for shadcn `<Table>`. Shown when the fetch failed.
 *
 *   {error && <TableErrorRow colSpan={6} error={error} />}
 */
export function TableErrorRow({ colSpan, error }: { colSpan: number; error: string }) {
    return (
        <TableRow>
            <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-destructive">
                {error}
            </TableCell>
        </TableRow>
    );
}
