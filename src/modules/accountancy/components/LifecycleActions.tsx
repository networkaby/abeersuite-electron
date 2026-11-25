"use client";
// Shared Cancel / Restore / Delete / Hard-Delete button strip + dialogs.
// Used on every voucher detail page (Sales, Purchases, Estimates, JournalEntry) so the
// lifecycle UX is uniform across voucher types.
//
// SOFT-delete + its restore were retired (2026-06-09): Cancel (void, stays visible) and
// Hard-Delete (purge, but recoverable from the Recycle Bin via the AuditLog snapshot)
// cover the same ground without a third hidden-but-recoverable tier. A DRAFT (impact-free)
// is removed straight through Hard-Delete — it lands in the Recycle Bin like everything else.
//
// RESTORE here is a different thing: it un-cancels, putting a CANCELLED voucher back to
// POSTED and re-applying exactly what the cancel reversed. It is gated by `canCancel` —
// whoever may cancel a voucher may restore it. When the rewards a cancel handed back
// (gift-card money, a coupon slot, loyalty points) have since been spent on another bill,
// the API answers 409 with a `conflicts` list instead of acting; the dialog shows those in
// plain words and the user may still go ahead, which re-sends with `force`.
//
// The caller supplies the API base path (e.g. /api/inventory/vouchers/42) and the resource
// label for dialog copy. The component handles state, requests, and toasts.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { VoucherRestoreDialog } from "@/modules/accountancy/components/VoucherRestoreDialog";
import { useRouter } from "next/navigation";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import { NO_ACCESS_HOME } from "@/shared/lib/auth/pageAccess";
import { Loader2, XCircle, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export interface LifecycleVoucher {
    status:      string;
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
    // After a removal, back to the register — or Work Flow, for someone the page lock
    // (pageAccess.ts) keeps out of it.
    const canOpen = useCanOpenPage();
    const [busy, setBusy] = useState<string | null>(null);

    const [showCancel, setShowCancel] = useState(false);
    const [cancelReason, setCancelReason] = useState("");

    const [showHardDelete, setShowHardDelete] = useState(false);
    const [hardDeleteReason, setHardDeleteReason] = useState("");

    const [showRestore, setShowRestore] = useState(false);

    const post = async (path: string, body?: object, successMsg = "Done") => {
        setBusy(path);
        try {
            await axios.post(`${apiBasePath}/${path}`, body);
            toast.success(successMsg);
            onChanged();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed"));
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
                {isCancelled && canCancel && (
                    <Button variant="outline" onClick={() => setShowRestore(true)}>
                        <RotateCcw size={14} /> Restore
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

            <VoucherRestoreDialog
                open={showRestore}
                onClose={() => setShowRestore(false)}
                apiBasePath={apiBasePath}
                label={label}
                onRestored={onChanged}
            />

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
                                router.push(canOpen(listPath) ? listPath : NO_ACCESS_HOME);
                            } catch (err: unknown) {
                                toast.error(extractApiError(err, "Failed"));
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
