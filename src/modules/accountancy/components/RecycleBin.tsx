"use client";

// Recycle bin over the AuditLog snapshots — lists hard-deleted vouchers / journal
// entries the user may restore, with a one-click Restore (POST /api/audit/[id]/restore,
// which faithfully rebuilds the entity from its JSON snapshot).

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Undo2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/shared/lib/format/formatDate";

interface AuditRow {
    id: number;
    entityType: "INV_VOUCHER" | "GL_VOUCHER" | "JOURNAL_ENTRY";
    originalRef: string;
    action: string;
    reason: string | null;
    createdAt: string;
    restoredAt: string | null;
    actor: { id: number; name: string } | null;
    restoredBy: { id: number; name: string } | null;
}

const TYPE_LABEL: Record<AuditRow["entityType"], string> = {
    INV_VOUCHER: "Inventory voucher",
    GL_VOUCHER: "GL voucher",
    JOURNAL_ENTRY: "Journal entry",
};

export function RecycleBin() {
    const [rows, setRows] = useState<AuditRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [includeRestored, setIncludeRestored] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        axios
            .get<AuditRow[]>(`/api/audit${includeRestored ? "?includeRestored=1" : ""}`)
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load recycle bin"))
            .finally(() => setLoading(false));
    }, [includeRestored]);

    useEffect(() => { load(); }, [load]);

    const restore = async (row: AuditRow) => {
        setBusyId(row.id);
        try {
            const { data } = await axios.post<{ reference: string }>(`/api/audit/${row.id}/restore`);
            toast.success(`Restored ${data.reference}`);
            load();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? "Restore failed");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <div className="flex items-center gap-3 border-b px-6 py-3">
                <Trash2 size={18} className="text-muted-foreground" />
                <div className="mr-auto">
                    <h1 className="text-base font-semibold leading-tight">Recycle Bin</h1>
                    <p className="text-xs text-muted-foreground">Hard-deleted vouchers &amp; journal entries — restore rebuilds them from their snapshot.</p>
                </div>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setIncludeRestored((v) => !v)}>
                    {includeRestored ? "Hide restored" : "Show restored"}
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={load}>
                    <RefreshCw size={13} className="mr-1" /> Refresh
                </Button>
            </div>

            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
                ) : rows.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Trash2 size={36} strokeWidth={1} />
                        <p className="text-sm">The recycle bin is empty.</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                            <tr className="border-b">
                                <th className="px-4 py-2 text-left font-medium">Reference</th>
                                <th className="px-4 py-2 text-left font-medium">Type</th>
                                <th className="px-4 py-2 text-left font-medium">Reason</th>
                                <th className="px-4 py-2 text-left font-medium">Deleted by</th>
                                <th className="px-4 py-2 text-left font-medium">Deleted at</th>
                                <th className="px-4 py-2 text-right font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {rows.map((row) => (
                                <tr key={row.id} className="hover:bg-muted/40">
                                    <td className="px-4 py-2.5 font-mono text-xs font-medium">{row.originalRef}</td>
                                    <td className="px-4 py-2.5"><Badge variant="secondary" className="text-xs">{TYPE_LABEL[row.entityType]}</Badge></td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{row.reason ?? "—"}</td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actor?.name ?? "—"}</td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt)}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        {row.restoredAt ? (
                                            <Badge variant="outline" className="text-xs">Restored{row.restoredBy ? ` · ${row.restoredBy.name}` : ""}</Badge>
                                        ) : (
                                            <Button size="sm" variant="outline" className="h-7" disabled={busyId === row.id} onClick={() => restore(row)}>
                                                {busyId === row.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} className="mr-1" />} Restore
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            <div className="border-t px-6 py-2 text-[11px] text-muted-foreground">
                Note: links to orders, tickets and deals are not reconnected on restore.
            </div>
        </div>
    );
}
