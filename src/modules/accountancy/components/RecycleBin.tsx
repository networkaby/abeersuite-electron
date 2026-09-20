"use client";

// Recycle bin over the AuditLog snapshots — lists hard-deleted vouchers / journal
// entries the user may restore, with a one-click Restore (POST /api/audit/[id]/restore,
// which faithfully rebuilds the entity from its JSON snapshot).

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, Undo2, RefreshCw, Trash2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/shared/lib/format/formatDate";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { extractApiError } from "@/shared/lib/api";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

interface AuditRow {
    id: number;
    entityType: "INV_VOUCHER" | "GL_VOUCHER" | "JOURNAL_ENTRY";
    subtype: string | null;
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
    const [confirmPurgeId, setConfirmPurgeId] = useState<number | null>(null);

    // Permanent delete is SUPER ADMIN only. `admin:bypass` is a code-only sentinel
    // (never seeded, un-grantable in the Role Matrix) held solely by the env super
    // admin, so this hides the button for every normal staff login. The API enforces
    // it independently — this is decluttering, not the gate.
    const { data: session } = useSession();
    const isSuperAdmin = ((session?.user as { permissions?: string[] } | undefined)?.permissions ?? [])
        .includes("admin:bypass");

    // `silent` refetches WITHOUT swapping the table for the spinner. Restore /
    // delete already mutate `rows` locally, so the follow-up revalidation must not
    // blank the list — flipping `loading` there tore the table down and rebuilt it,
    // which read as the whole page blinking and threw away the scroll position.
    // The spinner is for the very first load only.
    const load = useCallback((opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        return axios
            .get<AuditRow[]>(`/api/audit${includeRestored ? "?includeRestored=1" : ""}`)
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load recycle bin"))
            .finally(() => { if (!opts?.silent) setLoading(false); });
    }, [includeRestored]);

    // First mount shows the spinner; later runs (the Show restored toggle) refetch
    // in place so the rows already on screen stay put.
    const hasLoadedOnce = useRef(false);
    useEffect(() => {
        load({ silent: hasLoadedOnce.current });
        hasLoadedOnce.current = true;
    }, [load]);

    // A voucher deleted or restored at another counter belongs in this list too;
    // `/api/audit/...` announces both topics (a restore can bring a voucher back).
    useRealtimeTopics(["ledger", "stock"], () => { void load({ silent: true }); });

    // Manual refresh keeps the table on screen and spins the button's own icon —
    // feedback without tearing the list down. (`onClick={load}` also passed the
    // click event straight in as the options object.)
    const [refreshing, setRefreshing] = useState(false);
    const refresh = async () => {
        setRefreshing(true);
        try { await load({ silent: true }); } finally { setRefreshing(false); }
    };

    const restore = async (row: AuditRow) => {
        setBusyId(row.id);
        try {
            const { data } = await axios.post<{ reference: string }>(`/api/audit/${row.id}/restore`);
            toast.success(`Restored ${data.reference}`);
            // Update this row in place: it drops out of the default view, or flips to
            // the "Restored" badge when restored rows are being shown. Then revalidate
            // quietly so the server stays the source of truth.
            setRows((rs) => includeRestored
                ? rs.map((r) => (r.id === row.id ? { ...r, restoredAt: new Date().toISOString() } : r))
                : rs.filter((r) => r.id !== row.id));
            load({ silent: true });
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Restore failed"));
        } finally {
            setBusyId(null);
        }
    };

    // Destroys the snapshot — the last surviving copy of the voucher. Two clicks
    // (the row arms itself, then "Delete forever") so it can't go on a mis-click.
    const purge = async (row: AuditRow) => {
        setBusyId(row.id);
        try {
            const { data } = await axios.delete<{ releasedRef?: string | null }>(`/api/audit/${row.id}`);
            // The number comes back only when this voucher held the tip of its series;
            // say so, because the next bill will then carry the very same number.
            toast.success(data?.releasedRef
                ? `${row.originalRef} deleted permanently — number released for re-use`
                : `${row.originalRef} deleted permanently`);
            setConfirmPurgeId(null);
            // Drop the row immediately — it is gone for good, so there is nothing to
            // re-fetch it back. Revalidate quietly to catch anything else that changed.
            setRows((rs) => rs.filter((r) => r.id !== row.id));
            load({ silent: true });
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Permanent delete failed"));
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
                <Button size="sm" variant="outline" className="h-8" disabled={refreshing} onClick={refresh}>
                    <RefreshCw size={13} className={`mr-1 ${refreshing ? "animate-spin" : ""}`} /> Refresh
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
                                    <td className="px-4 py-2.5"><Badge variant="secondary" className="text-xs">{voucherTypeLabel(row.subtype) ?? TYPE_LABEL[row.entityType]}</Badge></td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{row.reason ?? "—"}</td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actor?.name ?? "—"}</td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt)}</td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center justify-end gap-2">
                                            {row.restoredAt ? (
                                                <Badge variant="outline" className="text-xs">Restored{row.restoredBy ? ` · ${row.restoredBy.name}` : ""}</Badge>
                                            ) : (
                                                <Button size="sm" variant="outline" className="h-7" disabled={busyId === row.id} onClick={() => restore(row)}>
                                                    {busyId === row.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} className="mr-1" />} Restore
                                                </Button>
                                            )}
                                            {isSuperAdmin && (
                                                confirmPurgeId === row.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <Button size="sm" variant="destructive" className="h-7" disabled={busyId === row.id} onClick={() => purge(row)}>
                                                            {busyId === row.id ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} className="mr-1" />} Delete forever
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmPurgeId(null)}>Cancel</Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 text-destructive hover:text-destructive"
                                                        title="Permanently destroy this snapshot — the voucher becomes unrecoverable"
                                                        onClick={() => setConfirmPurgeId(row.id)}
                                                    >
                                                        <Trash2 size={13} />
                                                    </Button>
                                                )
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            <div className="border-t px-6 py-2 text-[11px] text-muted-foreground">
                Note: links to orders, tickets and deals are not reconnected on restore.
                {isSuperAdmin && " Delete forever destroys the snapshot — that voucher can never be recovered."}
            </div>
        </div>
    );
}
