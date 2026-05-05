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
    status: "DRAFT" | "POSTED" | "VOIDED";
    postedAt: string | null;
    voidedAt: string | null;
    voidReason: string | null;
    deletedAt: string | null;
    deleteReason: string | null;
    createdBy: { id: number; name: string };
    createdAt: string;
    lines: JournalLine[];
}

const STATUS_COLORS = {
    DRAFT:  "bg-yellow-100 text-yellow-700 border-yellow-200",
    POSTED: "bg-green-100 text-green-700 border-green-200",
    VOIDED: "bg-muted text-muted-foreground border-border",
};


export default function JournalEntryDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canVoid = hasPermissionWithScope(permissions, "finance:journal:void");
    const canSoftDelete = hasPermissionWithScope(permissions, "finance:journal:soft-delete");
    const canHardDelete = hasPermissionWithScope(permissions, "finance:journal:hard-delete");

    const [entry, setEntry] = useState<JournalEntry | null>(null);
    const [loading, setLoading] = useState(true);
    const [posting, setPosting] = useState(false);
    const [showVoid, setShowVoid] = useState(false);
    const [voidReason, setVoidReason] = useState("");
    const [voiding, setVoiding] = useState(false);
    const [showSoftDelete, setShowSoftDelete] = useState(false);
    const [softDeleteReason, setSoftDeleteReason] = useState("");
    const [softDeleting, setSoftDeleting] = useState(false);
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

    const voidEntry = async () => {
        if (!voidReason.trim()) { toast.error("Reason required"); return; }
        setVoiding(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/void`, { reason: voidReason });
            toast.success("Entry voided — reversal entry created");
            setShowVoid(false);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to void");
        } finally {
            setVoiding(false);
        }
    };

    const softDelete = async () => {
        if (!softDeleteReason.trim()) { toast.error("Reason required"); return; }
        setSoftDeleting(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/soft-delete`, { reason: softDeleteReason });
            toast.success("Entry soft-deleted — hidden from views and excluded from balances");
            setShowSoftDelete(false);
            setSoftDeleteReason("");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to soft-delete");
        } finally {
            setSoftDeleting(false);
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
            router.push("/office/finance/journal-entries");
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
                <Link href="/office/finance/journal-entries" className="text-muted-foreground hover:text-foreground">
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
                            {canSoftDelete && (
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
                            {entry.status === "POSTED" && canVoid && (
                                <Button variant="outline" onClick={() => setShowVoid(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                                    <XCircle size={14} /> Void
                                </Button>
                            )}
                            {entry.status !== "VOIDED" && canSoftDelete && (
                                <Button variant="outline" onClick={() => setShowSoftDelete(true)}>
                                    <Trash2 size={14} /> Soft Delete
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
                {entry.voidedAt && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Voided at</p>
                        <p className="font-medium text-destructive">{new Date(entry.voidedAt).toLocaleString()}</p>
                    </div>
                )}
                {entry.voidReason && (
                    <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Void reason</p>
                        <p className="font-medium text-destructive">{entry.voidReason}</p>
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

            {/* Void Dialog */}
            <Dialog open={showVoid} onOpenChange={(open) => { if (!open) setShowVoid(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Void Journal Entry</DialogTitle>
                        <DialogDescription>
                            This will create a reversal entry and update GL balances. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            rows={3}
                            placeholder="Reason for voiding..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowVoid(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={voidEntry} disabled={voiding}>
                            {voiding && <Loader2 size={14} className="animate-spin" />} Confirm Void
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Soft Delete Dialog */}
            <Dialog open={showSoftDelete} onOpenChange={(open) => { if (!open) setShowSoftDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Soft Delete Journal Entry</DialogTitle>
                        <DialogDescription>
                            Hides the entry from default views and excludes it from balance calculations. Recoverable via Restore.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea
                            value={softDeleteReason}
                            onChange={(e) => setSoftDeleteReason(e.target.value)}
                            rows={3}
                            placeholder="Reason for deleting..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSoftDelete(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={softDelete} disabled={softDeleting}>
                            {softDeleting && <Loader2 size={14} className="animate-spin" />} Confirm Soft Delete
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
                        <Button variant="outline" onClick={() => setShowHardDelete(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={hardDelete} disabled={hardDeleting}>
                            {hardDeleting && <Loader2 size={14} className="animate-spin" />} Permanently Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
