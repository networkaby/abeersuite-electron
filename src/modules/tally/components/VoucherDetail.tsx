"use client";
// Shared detail view for the unified Voucher table. Includes the full lifecycle
// dialog set: Cancel / Delete / Restore / Hard Delete.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, CheckCircle, XCircle, Trash2, Undo2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { fmt } from "@/utils/constants";
import { hasPermissionWithScope } from "@/lib/permission-scope";

import type { VoucherFormType } from "./VoucherForm";

const STATUS_COLORS: Record<string, string> = {
    DRAFT:     "bg-yellow-100 text-yellow-700 border-yellow-200",
    POSTED:    "bg-green-100 text-green-700 border-green-200",
    CANCELLED: "bg-muted text-muted-foreground border-border",
};

interface Voucher {
    id:           number;
    type:         VoucherFormType;
    reference:    string;
    date:         string;
    narration:    string | null;
    totalAmount:  number;
    status:       "DRAFT" | "POSTED" | "CANCELLED";
    postedAt:     string | null;
    cancelledAt:  string | null;
    cancelReason: string | null;
    deletedAt:    string | null;
    deleteReason: string | null;
    journalEntryId: number | null;
    createdBy:    { id: number; name: string };
    createdAt:    string;
    partyAccount: { id: number; code: string; name: string } | null;
    lines: {
        id: number;
        type: "DEBIT" | "CREDIT";
        amount: number;
        description: string | null;
        account: { id: number; code: string; name: string };
    }[];
}

export function VoucherDetail({ basePath }: { basePath: string }) {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel     = hasPermissionWithScope(permissions, "finance:voucher:cancel");
    const canDelete     = hasPermissionWithScope(permissions, "finance:voucher:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "finance:voucher:hard-delete");

    const [voucher, setVoucher] = useState<Voucher | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    const [showCancel, setShowCancel] = useState(false);
    const [cancelReason, setCancelReason] = useState("");
    const [showDelete, setShowDelete] = useState(false);
    const [deleteReason, setDeleteReason] = useState("");
    const [showHardDelete, setShowHardDelete] = useState(false);
    const [hardDeleteReason, setHardDeleteReason] = useState("");

    const load = () => {
        setLoading(true);
        axios.get<Voucher>(`/api/finance/vouchers/${id}`)
            .then((r) => setVoucher(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };
    useEffect(load, [id]);

    const action = async (path: string, body?: object, successMsg = "Done") => {
        setBusy(path);
        try {
            await axios.post(`/api/finance/vouchers/${id}/${path}`, body);
            toast.success(successMsg);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setBusy(null);
        }
    };

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-muted-foreground" size={32} /></div>;
    if (!voucher) return <div className="text-center py-24 text-muted-foreground">Not found</div>;

    const totalDebit  = voucher.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
    const totalCredit = voucher.lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Link href={basePath} className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold font-mono">{voucher.reference}</h1>
                        <span className={`text-xs px-2.5 py-1 border font-medium ${STATUS_COLORS[voucher.status]}`}>{voucher.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{voucher.narration ?? "—"}</p>
                </div>
                <div className="flex gap-2">
                    {voucher.deletedAt ? (
                        <>
                            {canDelete && (
                                <Button variant="outline" onClick={() => action("restore", undefined, "Voucher restored")} disabled={busy === "restore"}>
                                    {busy === "restore" ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Restore
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
                            {voucher.status === "DRAFT" && (
                                <Button onClick={() => action("post", undefined, "Voucher posted — GL updated")} disabled={busy === "post"} className="bg-green-600 hover:bg-green-700 text-white border-green-600">
                                    {busy === "post" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Post
                                </Button>
                            )}
                            {voucher.status === "POSTED" && canCancel && (
                                <Button variant="outline" onClick={() => setShowCancel(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                                    <XCircle size={14} /> Cancel
                                </Button>
                            )}
                            {voucher.status !== "CANCELLED" && canDelete && (
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

            {voucher.deletedAt && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                    <div className="flex items-center gap-2 font-medium text-destructive">
                        <AlertTriangle size={16} /> Deleted on {new Date(voucher.deletedAt).toLocaleString()}
                    </div>
                    {voucher.deleteReason && <p className="mt-1 text-destructive/80">Reason: {voucher.deleteReason}</p>}
                </div>
            )}

            <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-card p-5 text-sm shadow">
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Date</p>
                    <p className="font-medium">{new Date(voucher.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Type</p>
                    <p className="font-medium">{voucher.type.replace(/_/g, " ")}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Created by</p>
                    <p className="font-medium">{voucher.createdBy.name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(voucher.createdAt).toLocaleString()}</p>
                </div>
                {voucher.partyAccount && (
                    <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Party</p>
                        <p className="font-medium">{voucher.partyAccount.code} — {voucher.partyAccount.name}</p>
                    </div>
                )}
                {voucher.journalEntryId && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Journal Entry</p>
                        <Link href={`/office/tally/journal-entries/${voucher.journalEntryId}`} className="font-medium text-primary hover:underline">JE #{voucher.journalEntryId}</Link>
                    </div>
                )}
                {voucher.cancelledAt && (
                    <div className="col-span-3 rounded bg-muted p-3 text-xs">
                        <p className="font-medium text-destructive">Cancelled on {new Date(voucher.cancelledAt).toLocaleString()}</p>
                        {voucher.cancelReason && <p className="text-muted-foreground mt-0.5">Reason: {voucher.cancelReason}</p>}
                    </div>
                )}
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-5 py-3 text-left font-medium">Account</th>
                            <th className="px-5 py-3 text-left font-medium">Note</th>
                            <th className="px-5 py-3 text-right font-medium w-32">Debit</th>
                            <th className="px-5 py-3 text-right font-medium w-32">Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {voucher.lines.map((l) => (
                            <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="px-5 py-3">
                                    <span className="font-mono text-muted-foreground mr-2">{l.account.code}</span>
                                    <span className="font-medium">{l.account.name}</span>
                                </td>
                                <td className="px-5 py-3 text-muted-foreground text-xs">{l.description ?? "—"}</td>
                                <td className="px-5 py-3 text-right font-mono">{l.type === "DEBIT" ? fmt(Number(l.amount)) : <span className="text-muted-foreground/40">—</span>}</td>
                                <td className="px-5 py-3 text-right font-mono">{l.type === "CREDIT" ? fmt(Number(l.amount)) : <span className="text-muted-foreground/40">—</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-muted border-t-2 border-border font-semibold text-sm">
                        <tr>
                            <td colSpan={2} className="px-5 py-3 text-muted-foreground">Total</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalDebit)}</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalCredit)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Cancel dialog */}
            <Dialog open={showCancel} onOpenChange={(o) => { if (!o) setShowCancel(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Cancel Voucher</DialogTitle>
                        <DialogDescription>
                            Reverses GL impact via a counter-entry. Reference number stays. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Reason for cancelling..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCancel(false)}>Back</Button>
                        <Button variant="destructive" disabled={!cancelReason.trim() || busy === "cancel"} onClick={async () => {
                            await action("cancel", { reason: cancelReason }, "Voucher cancelled — reversal entry created");
                            setShowCancel(false);
                            setCancelReason("");
                        }}>
                            {busy === "cancel" && <Loader2 size={14} className="animate-spin" />} Confirm Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete dialog */}
            <Dialog open={showDelete} onOpenChange={(o) => { if (!o) setShowDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete Voucher</DialogTitle>
                        <DialogDescription>
                            Hides from default views and excludes from balance calculations. Recoverable via Restore.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} rows={3} placeholder="Reason for deleting..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDelete(false)}>Back</Button>
                        <Button variant="destructive" disabled={!deleteReason.trim() || busy === "delete"} onClick={async () => {
                            await action("delete", { reason: deleteReason }, "Voucher deleted");
                            setShowDelete(false);
                            setDeleteReason("");
                        }}>
                            {busy === "delete" && <Loader2 size={14} className="animate-spin" />} Confirm Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Hard Delete dialog */}
            <Dialog open={showHardDelete} onOpenChange={(o) => { if (!o) setShowHardDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangle size={18} /> Hard Delete Voucher</DialogTitle>
                        <DialogDescription>
                            Permanently removes the voucher and its lines. A snapshot is kept in the audit log so the deletion is traceable. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={hardDeleteReason} onChange={(e) => setHardDeleteReason(e.target.value)} rows={3} placeholder="Reason for permanent deletion..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowHardDelete(false)}>Back</Button>
                        <Button variant="destructive" disabled={!hardDeleteReason.trim() || busy === "hard-delete"} onClick={async () => {
                            await axios.post(`/api/finance/vouchers/${id}/hard-delete`, { reason: hardDeleteReason })
                                .then(() => {
                                    toast.success("Voucher permanently deleted (snapshot kept in audit log)");
                                    router.push(basePath);
                                })
                                .catch((err) => {
                                    const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
                                    toast.error(msg ?? "Failed");
                                });
                        }}>
                            {busy === "hard-delete" && <Loader2 size={14} className="animate-spin" />} Permanently Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
