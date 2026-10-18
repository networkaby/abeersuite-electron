"use client";

// Recycle bin over the AuditLog snapshots — lists hard-deleted vouchers / journal
// entries the user may restore, with a one-click Restore (POST /api/audit/[id]/restore,
// which faithfully rebuilds the entity from its JSON snapshot).

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, Undo2, RefreshCw, Trash2, ShieldAlert, FileClock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/shared/lib/format/formatDate";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { extractApiError } from "@/shared/lib/api";
import { auditSnapshotKind } from "@/shared/lib/accountancy/auditSnapshotKind";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { AuditSnapshotDialog } from "./AuditSnapshotDialog";

interface AuditRow {
    id: number;
    entityType: "INV_VOUCHER" | "GL_VOUCHER" | "JOURNAL_ENTRY";
    /** The voucher this row is a copy OF — one voucher can have several rows here. */
    originalId: number;
    subtype: string | null;
    originalRef: string;
    action: string;
    reason: string | null;
    createdAt: string;
    restoredAt: string | null;
    /** The voucher this is a copy of is still on the books — Restore reverts it in place. */
    voucherLive?: boolean;
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
    const [viewId, setViewId] = useState<number | null>(null);

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
            const { data } = await axios.post<{ reference: string; reverted?: boolean }>(`/api/audit/${row.id}/restore`);
            toast.success(data.reverted ? `${data.reference} changed back to this version` : `Restored ${data.reference}`);
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

    // Destroys copies for good. How far it reaches depends on which kind the row is:
    // a DELETE copy is the voucher's last one, so the server takes every other copy of
    // that voucher with it; an EDIT copy is just an older picture of a voucher that is
    // still alive, so only that row goes. Two clicks (the row arms itself, then the
    // red button) so it can't go on a mis-click.
    const purge = async (row: AuditRow) => {
        setBusyId(row.id);
        const kind = auditSnapshotKind(row);
        try {
            const { data } = await axios.delete<{ releasedRef?: string | null; removed?: number }>(`/api/audit/${row.id}`);
            const ref = row.originalRef || "Voucher";
            // The number comes back only when this voucher held the tip of its series;
            // say so, because the next voucher will then carry the very same number.
            toast.success(kind === "EDIT"
                ? `Pre-edit copy of ${ref} destroyed — ${ref} itself is untouched`
                : `${ref} deleted completely${(data?.removed ?? 1) > 1 ? ` (${data!.removed} copies)` : ""}`
                  + (data?.releasedRef ? " — number released for re-use" : ""));
            setConfirmPurgeId(null);
            // Drop what is gone immediately — it cannot be fetched back. A DELETE copy
            // took the voucher's other copies with it, so they leave the table too.
            setRows((rs) => rs.filter((r) => kind === "DELETE"
                ? !(r.entityType === row.entityType && r.originalId === row.originalId)
                : r.id !== row.id));
            load({ silent: true });
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Permanent delete failed"));
        } finally {
            setBusyId(null);
        }
    };

    // Empty the whole bin — super admin only, and armed by typing EMPTY so it cannot
    // go on a mis-click. The server repeats the same check.
    const [emptyArmed, setEmptyArmed] = useState(false);
    const [emptyText, setEmptyText] = useState("");
    const [emptying, setEmptying] = useState(false);
    const emptyBin = async () => {
        setEmptying(true);
        try {
            const { data } = await axios.delete<{ removed: number; released: string[] }>("/api/audit", { data: { confirm: emptyText } });
            toast.success(`Recycle bin emptied — ${data.removed} cop${data.removed === 1 ? "y" : "ies"} deleted`
                + (data.released.length ? `, ${data.released.length} number(s) released for re-use` : ""));
            setRows([]);
            setEmptyArmed(false);
            setEmptyText("");
            load({ silent: true });
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Could not empty the recycle bin"));
        } finally {
            setEmptying(false);
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
                {isSuperAdmin && (emptyArmed ? (
                    <div className="flex items-center gap-1">
                        <Input
                            autoFocus
                            value={emptyText}
                            onChange={(e) => setEmptyText(e.target.value.toUpperCase())}
                            onKeyDown={(e) => { if (e.key === "Enter" && emptyText === "EMPTY") void emptyBin(); if (e.key === "Escape") setEmptyArmed(false); }}
                            placeholder="Type EMPTY"
                            className="h-8 w-28 font-mono text-xs"
                        />
                        <Button size="sm" variant="destructive" className="h-8" disabled={emptyText !== "EMPTY" || emptying} onClick={emptyBin}>
                            {emptying ? <Loader2 size={13} className="mr-1 animate-spin" /> : <ShieldAlert size={13} className="mr-1" />} Delete everything
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEmptyArmed(false); setEmptyText(""); }}>Cancel</Button>
                    </div>
                ) : (
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-destructive hover:text-destructive"
                        disabled={rows.length === 0}
                        title="Delete every copy in the recycle bin for good — nothing in it can be restored afterwards"
                        onClick={() => setEmptyArmed(true)}
                    >
                        <Trash2 size={13} className="mr-1" /> Empty bin
                    </Button>
                ))}
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
                            {rows.map((row) => {
                            const kind = auditSnapshotKind(row);
                            return (
                                <tr key={row.id} className="hover:bg-muted/40">
                                    <td className="px-4 py-2.5 font-mono text-xs font-medium">{row.originalRef || <span className="text-muted-foreground">—</span>}</td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Badge variant="secondary" className="text-xs">{voucherTypeLabel(row.subtype) ?? TYPE_LABEL[row.entityType]}</Badge>
                                            {/* Which copy this is. A deleted voucher's row is its last one; an
                                                edit copy is only an older picture of a voucher still on the books. */}
                                            {kind === "EDIT" ? (
                                                <Badge variant="outline" className="border-amber-500/40 text-[10px] font-normal text-amber-700 dark:text-amber-400" title="An older version of a voucher that is still on the books. Deleting this copy only gives up going back to it.">
                                                    <FileClock size={10} className="mr-1" /> Pre-edit copy
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="border-destructive/40 text-[10px] font-normal text-destructive" title="The voucher was removed from the books. This is its last surviving copy.">
                                                    <Trash2 size={10} className="mr-1" /> Deleted voucher
                                                </Badge>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{row.reason ?? "—"}</td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actor?.name ?? "—"}</td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt)}</td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button size="sm" variant="ghost" className="h-7" title="See what this copy holds — read-only" onClick={() => setViewId(row.id)}>
                                                <Eye size={13} className="mr-1" /> View
                                            </Button>
                                            {row.restoredAt ? (
                                                <Badge variant="outline" className="text-xs">Restored{row.restoredBy ? ` · ${row.restoredBy.name}` : ""}</Badge>
                                            ) : row.voucherLive && row.entityType === "JOURNAL_ENTRY" ? (
                                                <Badge variant="outline" className="text-xs font-normal text-muted-foreground" title="This entry is still on the books. Edit it there instead.">
                                                    Still on books
                                                </Badge>
                                            ) : row.voucherLive ? (
                                                <Button size="sm" variant="outline" className="h-7" disabled={busyId === row.id} onClick={() => restore(row)}
                                                    title="The voucher is still on the books. This changes it back to this version, under the same number, and keeps the current version here as a copy.">
                                                    {busyId === row.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} className="mr-1" />} Revert to this version
                                                </Button>
                                            ) : (
                                                <Button size="sm" variant="outline" className="h-7" disabled={busyId === row.id} onClick={() => restore(row)}>
                                                    {busyId === row.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} className="mr-1" />} Restore
                                                </Button>
                                            )}
                                            {isSuperAdmin && (
                                                confirmPurgeId === row.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <Button size="sm" variant="destructive" className="h-7" disabled={busyId === row.id} onClick={() => purge(row)}>
                                                            {busyId === row.id ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} className="mr-1" />}
                                                            {kind === "EDIT" ? "Delete this copy" : "Delete voucher completely"}
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmPurgeId(null)}>Cancel</Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 text-destructive hover:text-destructive"
                                                        title={kind === "EDIT"
                                                            ? "Destroy this pre-edit copy — the voucher stays on the books, you only give up going back to this older version"
                                                            : "Delete this voucher completely — every copy of it goes, and it can never be recovered"}
                                                        onClick={() => setConfirmPurgeId(row.id)}
                                                    >
                                                        <Trash2 size={13} />
                                                    </Button>
                                                )
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
            <AuditSnapshotDialog auditId={viewId} onClose={() => setViewId(null)} />
            <div className="border-t px-6 py-2 text-[11px] text-muted-foreground">
                Note: links to orders, tickets and deals are not reconnected on restore.
                {isSuperAdmin && " A pre-edit copy can be destroyed on its own; deleting a deleted voucher removes every copy of it and frees its number if it was the last one issued."}
            </div>
        </div>
    );
}
