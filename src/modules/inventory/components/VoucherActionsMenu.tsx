"use client";

// 3-dot dropdown for an InvVoucher row. Mounts the confirm-with-reason
// dialog inline so the caller only has to render one component per row.
//
// Actions:
//   • Edit       — router.push to the voucher's edit page
//   • Cancel     — POST /api/inventory/vouchers/[id]/cancel  (reason required)
//   • Delete     — POST /api/inventory/vouchers/[id]/delete  (reason required)
//   • Duplicate  — POST /api/inventory/vouchers/[id]/duplicate → navigate to draft

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { MoreVertical, Pencil, Ban, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// Single source of truth for "where does this voucher type's read-only detail
// page live". Used by Duplicate (which lands on the detail of a fresh draft)
// and by any consumer that wants to link to a voucher elsewhere.
export const VOUCHER_URLS: Record<string, string> = {
    PURCHASE:        "/office/inventory/purchases",
    SALE:            "/office/inventory/sales",
    SALE_RETURN:     "/office/inventory/sale-returns",
    PURCHASE_RETURN: "/office/inventory/purchase-returns",
    GRN:             "/office/inventory/grn",
    CHALLAN:         "/office/inventory/challans",
    REJECTION_IN:    "/office/inventory/rejections-in",
    REJECTION_OUT:   "/office/inventory/rejections-out",
    PHYSICAL_STOCK:  "/office/inventory/physical-stock",
    STOCK_JOURNAL:   "/office/inventory/stock-journals",
};

export function voucherUrl(type: string, id: number): string | null {
    const base = VOUCHER_URLS[type];
    return base ? `${base}/${id}` : null;
}

// Trading types have full-page EDITABLE forms at top-level routes. Edit drills
// here with `?voucherId=` so the form prefills + PATCHes on save. The other
// voucher types still use the read-only detail page (no editable equivalent
// yet — Edit falls back to VOUCHER_URLS for them).
const EDIT_FORM_URLS: Record<string, string> = {
    SALE:            "/sale",
    PURCHASE:        "/purchase",
    SALE_RETURN:     "/sale-return",
    PURCHASE_RETURN: "/purchase-return",
};

function editFormUrl(type: string, id: number): string | null {
    const base = EDIT_FORM_URLS[type];
    if (base) return `${base}?voucherId=${id}`;
    return voucherUrl(type, id);
}

interface Props {
    voucherId: number;
    voucherType: string;
    voucherRef: string;
    /** Fired after a state-changing action (cancel / delete) so the caller can refresh. */
    onChanged?: () => void;
}

type ConfirmAction = "cancel" | "delete" | null;

export function VoucherActionsMenu({ voucherId, voucherType, voucherRef, onChanged }: Props) {
    const router = useRouter();
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    const hasEditableForm = voucherType in EDIT_FORM_URLS;

    // Edit just navigates to the editable form with ?voucherId=. The form
    // prefills from the voucher and PATCHes on save. Server-side PATCH
    // handles both DRAFT (simple update) and POSTED (reverse + apply +
    // re-post in a single transaction) so the reference number is preserved
    // either way. Falls back to the read-only detail page for types that
    // don't have a full-page editable form yet (GRN, CHALLAN, etc.).
    const goEdit = () => {
        const url = hasEditableForm
            ? editFormUrl(voucherType, voucherId)
            : voucherUrl(voucherType, voucherId);
        if (url) router.push(url);
        else toast.error(`No edit page for voucher type ${voucherType}`);
    };

    const startCancel = () => { setReason(""); setConfirmAction("cancel"); };
    const startDelete = () => { setReason(""); setConfirmAction("delete"); };

    const submitConfirm = async () => {
        if (!confirmAction) return;
        if (!reason.trim()) return;
        setBusy(true);
        try {
            await axios.post(`/api/inventory/vouchers/${voucherId}/${confirmAction}`, {
                reason: reason.trim(),
            });
            toast.success(confirmAction === "cancel" ? "Voucher cancelled" : "Voucher deleted");
            setConfirmAction(null);
            onChanged?.();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? `Failed to ${confirmAction} voucher`);
        } finally {
            setBusy(false);
        }
    };

    const duplicate = async () => {
        setBusy(true);
        try {
            const { data } = await axios.post<{ id: number; type: string; reference: string }>(
                `/api/inventory/vouchers/${voucherId}/duplicate`,
            );
            const url = voucherUrl(data.type, data.id);
            toast.success(`Duplicated as ${data.reference}`);
            if (url) router.push(url);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? "Failed to duplicate voucher");
        } finally {
            setBusy(false);
        }
    };

    const isCancel = confirmAction === "cancel";
    const title = isCancel
        ? `Cancel voucher ${voucherRef}?`
        : `Delete voucher ${voucherRef}?`;
    const description = isCancel
        ? "Stock and GL impact will be reversed via a counter-entry. The voucher remains visible but is marked CANCELLED."
        : "Soft-delete — stock and GL impact are reversed and the row is hidden. Recoverable from the audit log.";
    const confirmLabel = isCancel ? "Confirm cancel" : "Confirm delete";

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for voucher ${voucherRef}`}
                        title="Actions"
                    >
                        <MoreVertical className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={goEdit} disabled={busy}>
                        <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={startCancel}>
                        <Ban className="size-4" /> Cancel
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={startDelete}>
                        <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={duplicate} disabled={busy}>
                        <Copy className="size-4" /> Duplicate
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={confirmAction != null} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
                <DialogContent className="!max-w-md">
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{description}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label htmlFor="voucher-action-reason">Reason</Label>
                        <Input
                            id="voucher-action-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Required"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && reason.trim() && !busy) submitConfirm();
                            }}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setConfirmAction(null)} disabled={busy}>
                            Back
                        </Button>
                        <Button
                            type="button"
                            variant={isCancel ? "default" : "destructive"}
                            onClick={submitConfirm}
                            disabled={busy || !reason.trim()}
                        >
                            {busy ? "Working…" : confirmLabel}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
