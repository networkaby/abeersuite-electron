"use client";
// The Restore (un-cancel) box, shared by the voucher pages and the ⋮ menu.
// `force` is sent only after the user has read the conflict list and chosen to go ahead —
// a first attempt never forces, so the warning can never be skipped.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { isVoucherStale } from "@/modules/accountancy/lib/voucherStale";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

/** One thing that will go short if the cancelled rewards are taken back. */
type RestoreConflict = { kind: string; label: string; message: string };

export function VoucherRestoreDialog({ open, onClose, apiBasePath, label, onRestored }: {
    open:        boolean;
    onClose:     () => void;
    apiBasePath: string;
    label:       string;
    /** Restored here, or found already restored — either way the caller reloads. */
    onRestored?: () => void;
}) {
    const [reason, setReason] = useState("");
    const [conflicts, setConflicts] = useState<RestoreConflict[]>([]);
    const [busy, setBusy] = useState(false);
    const short = conflicts.length > 0;

    const close = () => { setReason(""); setConflicts([]); onClose(); };

    const submit = async () => {
        setBusy(true);
        try {
            await axios.post(`${apiBasePath}/restore`, { reason: reason.trim(), force: short });
            toast.success(`${label} restored`);
            close();
            onRestored?.();
        } catch (err: unknown) {
            const found = axios.isAxiosError(err) && err.response?.status === 409
                ? (err.response.data?.conflicts as RestoreConflict[] | undefined)
                : undefined;
            if (found?.length) { setConflicts(found); return; }
            toast.error(extractApiError(err, "Failed to restore"));
            if (isVoucherStale(err)) { close(); onRestored?.(); }
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) close(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className={short ? "flex items-center gap-2 text-destructive" : undefined}>
                        {short && <AlertTriangle size={18} />}
                        {short ? `Restoring ${label} will go short` : `Restore ${label}`}
                    </DialogTitle>
                    <DialogDescription>
                        {short
                            ? "Some of what the cancel gave back has already been used on another bill. Restoring takes it back anyway — you can adjust it afterwards."
                            : "Puts the voucher back to POSTED and re-applies the stock / GL impact the cancel reversed, along with any gift card, coupon or loyalty points it gave back."}
                    </DialogDescription>
                </DialogHeader>

                {short ? (
                    <ul className="space-y-2 text-sm">
                        {conflicts.map((c, i) => (
                            <li key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                                {c.message}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for restoring..." />
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={close} disabled={busy}>
                        {short ? "Cancel restore" : "Back"}
                    </Button>
                    <Button variant={short ? "destructive" : "default"} disabled={!reason.trim() || busy} onClick={() => void submit()}>
                        {busy && <Loader2 size={14} className="animate-spin" />}
                        {short ? "Restore anyway" : "Confirm Restore"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
