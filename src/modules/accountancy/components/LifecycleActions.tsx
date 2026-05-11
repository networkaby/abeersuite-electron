"use client";
// Shared Cancel / Delete / Restore / Hard-Delete button strip + dialogs.
// Used on every voucher detail page (Sales, Purchases, Estimates, Invoices,
// JournalEntry) so the lifecycle UX is uniform across voucher types.
//
// The caller supplies the API base path (e.g. /api/inventory/vouchers/42 or
// /api/accountancy/invoices/13) and the resource label for dialog copy. The
// component handles state, requests, and toasts.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, XCircle, Trash2, Undo2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export interface LifecycleVoucher {
    status:      string;
    deletedAt?:  string | null;
    cancelledAt?: string | null;
}

export function LifecycleActions({
    voucher, apiBasePath, listPath, label,
    canCancel, canDelete, canHardDelete,
    onChanged,
}: {
    voucher:       LifecycleVoucher;
    apiBasePath:   string;          // e.g. /api/inventory/vouchers/42
    listPath:      string;          // e.g. /office/accountancy/sales (for redirect on hard-delete)
    label:         string;          // e.g. "Sale Voucher", "Invoice"
    canCancel:     boolean;
    canDelete:     boolean;
    canHardDelete: boolean;
    onChanged:     () => void;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);

    const [showCancel, setShowCancel] = useState(false);
    const [cancelReason, setCancelReason] = useState("");

    const [showDelete, setShowDelete] = useState(false);
    const [deleteReason, setDeleteReason] = useState("");

    const [showHardDelete, setShowHardDelete] = useState(false);
    const [hardDeleteReason, setHardDeleteReason] = useState("");

    const post = async (path: string, body?: object, successMsg = "Done") => {
        setBusy(path);
        try {
            await axios.post(`${apiBasePath}/${path}`, body);
            toast.success(successMsg);
            onChanged();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setBusy(null);
        }
    };

    const isCancelled = voucher.status === "CANCELLED" || voucher.status === "VOID" || !!voucher.cancelledAt;
    const isDeleted   = !!voucher.deletedAt;
    const isPosted    = ["POSTED", "SENT", "PARTIAL", "PAID"].includes(voucher.status);
    const isDraft     = voucher.status === "DRAFT";

    return (
        <>
            <div className="flex gap-2">
                {isDeleted ? (
                    <>
                        {canDelete && (
                            <Button variant="outline" disabled={busy === "restore"} onClick={() => post("restore", undefined, `${label} restored`)}>
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
                        {isPosted && canCancel && !isCancelled && (
                            <Button variant="outline" onClick={() => setShowCancel(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                                <XCircle size={14} /> Cancel
                            </Button>
                        )}
                        {!isCancelled && !isDraft && canDelete && (
                            <Button variant="outline" onClick={() => setShowDelete(true)}>
                                <Trash2 size={14} /> Delete
                            </Button>
                        )}
                        {isDraft && canDelete && (
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

            <Dialog open={showCancel} onOpenChange={(o) => { if (!o) setShowCancel(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Cancel {label}</DialogTitle>
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
                            await post("cancel", { reason: cancelReason }, `${label} cancelled — reversal entry created`);
                            setShowCancel(false); setCancelReason("");
                        }}>
                            {busy === "cancel" && <Loader2 size={14} className="animate-spin" />} Confirm Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showDelete} onOpenChange={(o) => { if (!o) setShowDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete {label}</DialogTitle>
                        <DialogDescription>
                            Hides from default views and excludes from balance / stock calculations. Recoverable via Restore.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} rows={3} placeholder="Reason for deleting..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDelete(false)}>Back</Button>
                        <Button variant="destructive" disabled={!deleteReason.trim() || busy === "delete"} onClick={async () => {
                            await post("delete", { reason: deleteReason }, `${label} deleted`);
                            setShowDelete(false); setDeleteReason("");
                        }}>
                            {busy === "delete" && <Loader2 size={14} className="animate-spin" />} Confirm Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showHardDelete} onOpenChange={(o) => { if (!o) setShowHardDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle size={18} /> Hard Delete {label}
                        </DialogTitle>
                        <DialogDescription>
                            Permanently removes the row. A snapshot is kept in the audit log so the deletion is traceable. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={hardDeleteReason} onChange={(e) => setHardDeleteReason(e.target.value)} rows={3} placeholder="Reason for permanent deletion..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowHardDelete(false)}>Back</Button>
                        <Button variant="destructive" disabled={!hardDeleteReason.trim() || busy === "hard-delete"} onClick={async () => {
                            try {
                                setBusy("hard-delete");
                                await axios.post(`${apiBasePath}/hard-delete`, { reason: hardDeleteReason });
                                toast.success(`${label} permanently deleted (snapshot kept in audit log)`);
                                router.push(listPath);
                            } catch (err: unknown) {
                                const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
                                toast.error(msg ?? "Failed");
                                setBusy(null);
                            }
                        }}>
                            {busy === "hard-delete" && <Loader2 size={14} className="animate-spin" />} Permanently Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
