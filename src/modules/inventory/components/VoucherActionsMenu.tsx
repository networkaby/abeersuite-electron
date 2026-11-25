"use client";

// 3-dot dropdown for an InvVoucher row. Mounts the confirm-with-reason
// dialog inline so the caller only has to render one component per row.
//
// Actions:
//   • Edit       — router.push to the voucher's edit page
//   • Cancel     — POST /api/inventory/vouchers/[id]/cancel  (reason required)
//   • Delete     — POST /api/inventory/vouchers/[id]/hard-delete  (reason required)
//                  There is only ONE delete: the row is removed and the whole
//                  graph is snapshotted to AuditLog = the Recycle Bin, which
//                  restores via POST /api/audit/[id]/restore.
//   • Duplicate  — POST /api/inventory/vouchers/[id]/duplicate → navigate to draft
//   • Send on WhatsApp — a customer document whose template is switched on
//   • Send email — the same, on Settings → Email Templates

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { MoreVertical, Pencil, Ban, Trash2, Copy, Printer, MessageCircle } from "lucide-react";
import { isVoucherStale } from "@/modules/accountancy/lib/voucherStale";
import { extractApiError } from "@/shared/lib/api";
import { canActOnVoucher } from "@/shared/lib/auth/posVoucherMatrix";
import { autoKindForVoucherType, waSendHint } from "@/shared/lib/whatsapp/billTemplates";
import { sendOnWhatsApp, useWaSendStates } from "@/shared/hooks/useWhatsAppSend";
import { SendEmailMenuItem } from "@/shared/components/SendEmailMenuItem";
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

// Pure voucher URL-builder maps + helpers now live in a non-client module so
// server code (account-ledger report route) can import them without tripping
// Next.js's "called a client function from the server" guard. Re-exported here
// for backward compatibility with the many client importers of these symbols.
import {
    VOUCHER_URLS, voucherUrl, EDIT_FORM_URLS, editFormUrl,
} from "@/modules/inventory/lib/voucherFormUrls";

export { VOUCHER_URLS, voucherUrl, editFormUrl };

interface Props {
    voucherId: number;
    voucherType: string;
    voucherRef: string;
    /** Fired after a state-changing action (cancel / delete) so the caller can refresh. */
    onChanged?: () => void;
}

type ConfirmAction = "cancel" | "hard-delete" | null;

export function VoucherActionsMenu({ voucherId, voucherType, voucherRef, onChanged }: Props) {
    const router = useRouter();
    const canOpen = useCanOpenPage();
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    // Edit / Cancel / Delete follow the Role page's ticks for this kind — the
    // same rule as the Day Book menu and the server (canActOnVoucher).
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit   = canActOnVoucher(voucherType, "cancel", perms);
    const canDelete = canActOnVoucher(voucherType, "delete", perms);

    const hasEditableForm = voucherType in EDIT_FORM_URLS;

    const waKind = autoKindForVoucherType(voucherType);
    const waStates = useWaSendStates();
    const waHint = waKind ? waSendHint(waStates[waKind]) : null;
    const canSendWa = waKind != null && waStates[waKind] === "ready";
    const sendWa = async () => {
        setBusy(true);
        await sendOnWhatsApp({ source: "inv", id: voucherId }).finally(() => setBusy(false));
    };

    // "Print labels" — surfaces a shortcut on receiving / purchase vouchers
    // to jump straight to the barcode-label print page with the voucher's
    // lines preloaded (productId × ceil(qty)). Restricted to GRN / PURCHASE
    // because those are the canonical "goods just arrived, sticker them up"
    // workflows. Extend the allow-list when MJ / SALE_RETURN / etc. become
    // sensible entry points.
    // …and only for someone who may open Print labels (the page lock).
    const canPrintLabels = (voucherType === "GRN" || voucherType === "PURCHASE")
        && canOpen("/office/pricing-strategy/print-labels");
    const goPrintLabels = () => {
        router.push(`/office/pricing-strategy/print-labels?fromVoucher=${voucherId}`);
    };

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
    const startDelete = () => { setReason(""); setConfirmAction("hard-delete"); };

    const submitConfirm = async () => {
        if (!confirmAction) return;
        if (!reason.trim()) return;
        setBusy(true);
        try {
            await axios.post(`/api/inventory/vouchers/${voucherId}/${confirmAction}`, {
                reason: reason.trim(),
            });
            toast.success(confirmAction === "cancel" ? "Voucher cancelled" : "Voucher removed (in Recycle Bin)");
            setConfirmAction(null);
            onChanged?.();
        } catch (e: unknown) {
            toast.error(extractApiError(e, `Failed to ${confirmAction} voucher`));
            if (isVoucherStale(e)) { setConfirmAction(null); onChanged?.(); }
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
            // Duplicate always produces a DRAFT — land on the editable form
            // (the read-only detail would force the user to click Edit again).
            const url = editFormUrl(data.type, data.id);
            toast.success(`Duplicated as ${data.reference}`);
            if (url) router.push(url);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to duplicate voucher"));
        } finally {
            setBusy(false);
        }
    };

    const isCancel = confirmAction === "cancel";
    const title = isCancel
        ? `Cancel voucher ${voucherRef}?`
        : `Delete voucher ${voucherRef}?`;
    const description = isCancel
        ? "Reverses the stock / GL impact and marks the voucher CANCELLED — it stays visible but is excluded from all totals."
        : "Removes the voucher and reverses its stock / GL impact. A full snapshot is kept in the Recycle Bin, so it can be restored later.";
    const confirmLabel = isCancel ? "Confirm cancel" : "Delete";

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
                <DropdownMenuContent align="end" className="w-60">
                    {canEdit && (
                        <DropdownMenuItem onSelect={goEdit} disabled={busy}>
                            <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                    )}
                    {canEdit && (
                        <DropdownMenuItem onSelect={startCancel}>
                            <Ban className="size-4" /> Cancel
                        </DropdownMenuItem>
                    )}
                    {canDelete && (
                        <DropdownMenuItem variant="destructive" onSelect={startDelete}>
                            <Trash2 className="size-4" /> Delete
                        </DropdownMenuItem>
                    )}
                    {(canEdit || canDelete) && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={duplicate} disabled={busy}>
                        <Copy className="size-4" /> Duplicate
                    </DropdownMenuItem>
                    {waKind && (
                        <DropdownMenuItem onSelect={() => void sendWa()} disabled={busy || !canSendWa} title={waHint ?? undefined}>
                            <MessageCircle className="size-4" />
                            <span className="flex flex-col">
                                Send on WhatsApp
                                {waHint && <span className="text-[10px] leading-tight text-muted-foreground">{waHint}</span>}
                            </span>
                        </DropdownMenuItem>
                    )}
                    <SendEmailMenuItem voucherType={voucherType} source="inv" id={voucherId} />
                    {canPrintLabels && (
                        <DropdownMenuItem onSelect={goPrintLabels} disabled={busy}>
                            <Printer className="size-4" /> Print labels
                        </DropdownMenuItem>
                    )}
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
