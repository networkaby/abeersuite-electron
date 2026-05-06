"use client";
import { fmt } from "@/utils/constants";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, CheckCircle, XCircle, Trash2, Undo2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { hasPermissionWithScope } from "@/lib/permission-scope";

interface JournalLine {
    id: number;
    type: "DEBIT" | "CREDIT";
    amount: number;
    description: string | null;
    account: { id: number; code: string; name: string; normalBalance: string };
}

interface JournalEntry {
    id: number;
    date: string;
    reference: string;
    description: string;
    status: "DRAFT" | "POSTED" | "CANCELLED";
    postedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    deletedAt: string | null;
    deleteReason: string | null;
    createdBy: { id: number; name: string };
    createdAt: string;
    lines: JournalLine[];
}

const STATUS_COLORS = {
    DRAFT:     "bg-yellow-100 text-yellow-700 border-yellow-200",
    POSTED:    "bg-green-100 text-green-700 border-green-200",
    CANCELLED: "bg-muted text-muted-foreground border-border",
};


export default function JournalEntryDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel = hasPermissionWithScope(permissions, "finance:journal:cancel");
    const canDelete = hasPermissionWithScope(permissions, "finance:journal:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "finance:journal:hard-delete");

    const [entry, setEntry] = useState<JournalEntry | null>(null);
    const [loading, setLoading] = useState(true);
    const [posting, setPosting] = useState(false);
    const [showCancel, setShowCancel] = useState(false);
    const [cancelReason, setCancelReason] = useState("");
    const [cancelling, setCancelling] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [deleteReason, setDeleteReason] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [showHardDelete, setShowHardDelete] = useState(false);
    const [hardDeleteReason, setHardDeleteReason] = useState("");
    const [hardDeleting, setHardDeleting] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const load = () => {
        setLoading(true);
        axios.get<JournalEntry>(`/api/finance/journal-entries/${id}`)
            .then((r) => setEntry(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    const post = async () => {
        setPosting(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/post`);
            toast.success("Entry posted — GL balances updated");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to post");
        } finally {
            setPosting(false);
        }
    };

    const cancelEntry = async () => {
        if (!cancelReason.trim()) { toast.error("Reason required"); return; }
        setCancelling(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/cancel`, { reason: cancelReason });
            toast.success("Entry cancelled — reversal entry created");
            setShowCancel(false);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to cancel");
        } finally {
            setCancelling(false);
        }
    };

    const deleteEntry = async () => {
        if (!deleteReason.trim()) { toast.error("Reason required"); return; }
        setDeleting(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/delete`, { reason: deleteReason });
            toast.success("Entry deleted — hidden from views and excluded from balances");
            setShowDelete(false);
            setDeleteReason("");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to delete");
        } finally {
            setDeleting(false);
        }
    };

    const restore = async () => {
        setRestoring(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/restore`);
            toast.success("Entry restored");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to restore");
        } finally {
            setRestoring(false);
        }
    };

    const hardDelete = async () => {
        if (!hardDeleteReason.trim()) { toast.error("Reason required"); return; }
        setHardDeleting(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/hard-delete`, { reason: hardDeleteReason });
            toast.success("Entry permanently deleted (snapshot kept in audit log)");
            setShowHardDelete(false);
            router.push("/office/tally/journal-entries");
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to hard-delete");
            setHardDeleting(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );

    if (!entry) return <div className="text-center py-24 text-muted-foreground">Not found</div>;

    const totalDebit = entry.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
    const totalCredit = entry.lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/office/tally/journal-entries" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-foreground font-mono">{entry.reference}</h1>
                        <span className={`text-xs px-2.5 py-1 border font-medium ${STATUS_COLORS[entry.status]}`}>
                            {entry.status}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{entry.description}</p>
                </div>
                <div className="flex gap-2">
                    {entry.deletedAt ? (
                        <>
                            {canDelete && (
                                <Button variant="outline" onClick={restore} disabled={restoring}>
                                    {restoring ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Restore
                                </Button>
                            )}
                            {canHardDelete && (
                                <Button variant="destructive" onClick={() => setShowHardDelete(true)}>
                                    <Trash2 size={14} /> Hard Delete
                                </Button>
                            )}
                        </>
                    ) : (
                        <>
                            {entry.status === "DRAFT" && (
                                <Button
                                    onClick={post}
                                    disabled={posting}
                                    className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                                >
                                    {posting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                                    Post Entry
                                </Button>
                            )}
                            {entry.status === "POSTED" && canCancel && (
                                <Button variant="outline" onClick={() => setShowCancel(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                                    <XCircle size={14} /> Cancel
                                </Button>
                            )}
                            {entry.status !== "CANCELLED" && canDelete && (
                                <Button variant="outline" onClick={() => setShowDelete(true)}>
                                    <Trash2 size={14} /> Delete
                                </Button>
                            )}
                            {canHardDelete && (
                                <Button variant="destructive" onClick={() => setShowHardDelete(true)}>
                                    <Trash2 size={14} /> Hard Delete
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {entry.deletedAt && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                    <div className="flex items-center gap-2 font-medium text-destructive">
                        <AlertTriangle size={16} /> Soft-deleted on {new Date(entry.deletedAt).toLocaleString()}
                    </div>
                    {entry.deleteReason && (
                        <p className="mt-1 text-destructive/80">Reason: {entry.deleteReason}</p>
                    )}
                    <p className="mt-1 text-muted-foreground">Hidden from default views and excluded from balance calculations.</p>
                </div>
            )}

            {/* Meta */}
            <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-card p-5 text-sm shadow">
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Date</p>
                    <p className="font-medium">
                        {new Date(entry.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Created by</p>
                    <p className="font-medium">{entry.createdBy.name}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Created at</p>
                    <p className="font-medium">{new Date(entry.createdAt).toLocaleString()}</p>
                </div>
                {entry.postedAt && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Posted at</p>
                        <p className="font-medium text-green-700">{new Date(entry.postedAt).toLocaleString()}</p>
                    </div>
                )}
                {entry.cancelledAt && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Cancelled at</p>
                        <p className="font-medium text-destructive">{new Date(entry.cancelledAt).toLocaleString()}</p>
                    </div>
                )}
                {entry.cancelReason && (
                    <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Cancel reason</p>
                        <p className="font-medium text-destructive">{entry.cancelReason}</p>
                    </div>
                )}
            </div>

            {/* Lines */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-5 py-3 text-left font-medium">Account</th>
                            <th className="px-5 py-3 text-left font-medium">Note</th>
                            <th className="px-5 py-3 text-right font-medium w-36">Debit</th>
                            <th className="px-5 py-3 text-right font-medium w-36">Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entry.lines.map((l) => (
                            <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="px-5 py-3">
                                    <span className="font-mono text-muted-foreground mr-2">{l.account.code}</span>
                                    <span className="font-medium text-foreground">{l.account.name}</span>
                                </td>
                                <td className="px-5 py-3 text-muted-foreground text-xs">{l.description ?? "—"}</td>
                                <td className="px-5 py-3 text-right font-mono">
                                    {l.type === "DEBIT"
                                        ? <span className="text-foreground">{fmt(Number(l.amount))}</span>
                                        : <span className="text-muted-foreground/40">—</span>
                                    }
                                </td>
                                <td className="px-5 py-3 text-right font-mono">
                                    {l.type === "CREDIT"
                                        ? <span className="text-foreground">{fmt(Number(l.amount))}</span>
                                        : <span className="text-muted-foreground/40">—</span>
                                    }
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-muted border-t-2 border-border font-semibold text-sm">
                        <tr>
                            <td colSpan={2} className="px-5 py-3 text-muted-foreground">Total</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalDebit)}</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalCredit)}</td>
                        </tr>
                        <tr>
                            <td colSpan={4} className="px-5 py-2 text-center text-xs">
                                {Math.abs(totalDebit - totalCredit) < 0.005
                                    ? <span className="text-green-600">✓ Balanced</span>
                                    : <span className="text-destructive">⚠ Not balanced — difference: {fmt(Math.abs(totalDebit - totalCredit))}</span>
                                }
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Cancel Dialog */}
            <Dialog open={showCancel} onOpenChange={(open) => { if (!open) setShowCancel(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Cancel Journal Entry</DialogTitle>
                        <DialogDescription>
                            Keeps the voucher number, reverses GL balances via a counter-entry, and marks this entry as CANCELLED. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            rows={3}
                            placeholder="Reason for cancelling..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCancel(false)}>Back</Button>
                        <Button variant="destructive" onClick={cancelEntry} disabled={cancelling}>
                            {cancelling && <Loader2 size={14} className="animate-spin" />} Confirm Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Dialog */}
            <Dialog open={showDelete} onOpenChange={(open) => { if (!open) setShowDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete Journal Entry</DialogTitle>
                        <DialogDescription>
                            Hides the entry from default views and excludes it from balance calculations. Recoverable via Restore.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea
                            value={deleteReason}
                            onChange={(e) => setDeleteReason(e.target.value)}
                            rows={3}
                            placeholder="Reason for deleting..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDelete(false)}>Back</Button>
                        <Button variant="destructive" onClick={deleteEntry} disabled={deleting}>
                            {deleting && <Loader2 size={14} className="animate-spin" />} Confirm Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Hard Delete Dialog */}
            <Dialog open={showHardDelete} onOpenChange={(open) => { if (!open) setShowHardDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle size={18} /> Hard Delete Journal Entry
                        </DialogTitle>
                        <DialogDescription>
                            Permanently removes the entry and its lines. A snapshot is kept in the audit log so the deletion is traceable. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea
                            value={hardDeleteReason}
                            onChange={(e) => setHardDeleteReason(e.target.value)}
                            rows={3}
                            placeholder="Reason for permanent deletion..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowHardDelete(false)}>Back</Button>
                        <Button variant="destructive" onClick={hardDelete} disabled={hardDeleting}>
                            {hardDeleting && <Loader2 size={14} className="animate-spin" />} Permanently Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
