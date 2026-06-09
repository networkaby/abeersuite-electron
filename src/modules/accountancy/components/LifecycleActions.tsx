"use client";
// Shared Cancel / Delete / Hard-Delete button strip + dialogs.
// Used on every voucher detail page (Sales, Purchases, Estimates, JournalEntry) so the
// lifecycle UX is uniform across voucher types.
//
// Soft-delete + Restore were retired (2026-06-09): Cancel (void, stays visible) and
// Hard-Delete (purge, but recoverable from the Recycle Bin via the AuditLog snapshot)
// cover the same ground without a third hidden-but-recoverable tier. A DRAFT (impact-free)
// is removed straight through Hard-Delete — it lands in the Recycle Bin like everything else.
//
// The caller supplies the API base path (e.g. /api/inventory/vouchers/42) and the resource
// label for dialog copy. The component handles state, requests, and toasts.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, XCircle, Trash2, AlertTriangle } from "lucide-react";
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
    listPath:      string;          // e.g. /office/accountancy/sales (for redirect on remove)
    label:         string;          // e.g. "Sale Voucher", "Invoice"
    canCancel:     boolean;
    canDelete:     boolean;         // gates draft removal
    canHardDelete: boolean;         // gates posted/cancelled removal
    onChanged:     () => void;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);

    const [showCancel, setShowCancel] = useState(false);
    const [cancelReason, setCancelReason] = useState("");

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
    const isPosted    = ["POSTED", "SENT", "PARTIAL", "PAID"].includes(voucher.status);
    const isDraft     = voucher.status === "DRAFT";

    // A draft is impact-free → removing it is just a (recoverable) hard-delete. A posted /
    // cancelled voucher is removed via hard-delete too (reverses impact, snapshot kept).
    const canRemove = isDraft ? canDelete : canHardDelete;
    const removeLabel = isDraft ? "Delete" : "Hard Delete";

    return (
        <>
            <div className="flex gap-2">
                {isPosted && canCancel && !isCancelled && (
                    <Button variant="outline" onClick={() => setShowCancel(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                        <XCircle size={14} /> Cancel
                    </Button>
                )}
                {canRemove && (
                    <Button variant="destructive" onClick={() => setShowHardDelete(true)}>
                        <Trash2 size={14} /> {removeLabel}
                    </Button>
                )}
            </div>

            <Dialog open={showCancel} onOpenChange={(o) => { if (!o) setShowCancel(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Cancel {label}</DialogTitle>
                        <DialogDescription>
                            Reverses the GL / stock impact and marks it CANCELLED — it stays visible in registers but is excluded from all totals. To reverse an old / filed period instead, post an office journal voucher.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Reason for cancelling..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCancel(false)}>Back</Button>
                        <Button variant="destructive" disabled={!cancelReason.trim() || busy === "cancel"} onClick={async () => {
                            await post("cancel", { reason: cancelReason }, `${label} cancelled`);
                            setShowCancel(false); setCancelReason("");
                        }}>
                            {busy === "cancel" && <Loader2 size={14} className="animate-spin" />} Confirm Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showHardDelete} onOpenChange={(o) => { if (!o) setShowHardDelete(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle size={18} /> {removeLabel} {label}
                        </DialogTitle>
                        <DialogDescription>
                            Removes the row and reverses any GL / stock impact. A full snapshot is kept in the <strong>Recycle Bin</strong>, so it can be restored later.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={hardDeleteReason} onChange={(e) => setHardDeleteReason(e.target.value)} rows={3} placeholder="Reason for removal..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowHardDelete(false)}>Back</Button>
                        <Button variant="destructive" disabled={!hardDeleteReason.trim() || busy === "hard-delete"} onClick={async () => {
                            try {
                                setBusy("hard-delete");
                                await axios.post(`${apiBasePath}/hard-delete`, { reason: hardDeleteReason });
                                toast.success(`${label} removed (restorable from the Recycle Bin)`);
                                router.push(listPath);
                            } catch (err: unknown) {
                                const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
                                toast.error(msg ?? "Failed");
                                setBusy(null);
                            }
                        }}>
                            {busy === "hard-delete" && <Loader2 size={14} className="animate-spin" />} Confirm
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
