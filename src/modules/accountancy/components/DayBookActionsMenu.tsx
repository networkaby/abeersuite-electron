"use client";

// 3-dot dropdown for a Day Book row. Works across all three voucher sources
// (inv / gl / je) by branching on the `source` prop.
//
// Actions:
//   • Edit       — navigate to the appropriate edit/detail page
//   • Cancel     — POST /<api-base>/<id>/cancel  (reason required)
//   • Delete     — POST /<api-base>/<id>/delete  (reason required)
//   • Duplicate  — POST /api/inventory/vouchers/<id>/duplicate → navigate (inv only)

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
import type { CombinedSource } from "@/modules/accountancy/hooks/useCombinedVouchers";
import { editFormUrl, voucherUrl } from "@/modules/inventory/components/VoucherActionsMenu";

// ── API base per source ────────────────────────────────────────────────────

function apiBase(source: CombinedSource, rawId: number): string {
    switch (source) {
        case "inv": return `/api/inventory/vouchers/${rawId}`;
        case "gl":  return `/api/accountancy/vouchers/${rawId}`;
        case "je":  return `/api/accountancy/journal-entries/${rawId}`;
    }
}

// ── Edit navigation URL per source ────────────────────────────────────────
// Mirrors the Day Book referenceHref so left-click on the reference and
// "Edit" in the ⋮ menu land on the same form.

const GL_EDIT_BASE: Record<string, string> = {
    PAYMENT:     "/vouchers/payments",
    RECEIPT:     "/vouchers/receipts",
    CONTRA:      "/vouchers/contras",
    CREDIT_NOTE: "/vouchers/credit-notes",
    DEBIT_NOTE:  "/vouchers/debit-notes",
};

function editUrl(
    source: CombinedSource,
    rawId: number,
    kind: string,
    _detailHref: string,
): string | null {
    switch (source) {
        case "inv": return editFormUrl(kind, rawId);
        case "gl":  return GL_EDIT_BASE[kind] ? `${GL_EDIT_BASE[kind]}/${rawId}` : null;
        case "je":  return `/vouchers/journal-entries/${rawId}`;
    }
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
    rawId:      number;
    source:     CombinedSource;
    kind:       string;
    reference:  string;
    detailHref: string;
    /** Fired after cancel / delete so the caller can reload. */
    onChanged?: () => void;
}

type ConfirmAction = "cancel" | "delete" | null;

// ── Component ─────────────────────────────────────────────────────────────

export function DayBookActionsMenu({
    rawId, source, kind, reference, detailHref, onChanged,
}: Props) {
    const router = useRouter();
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    const goEdit = () => {
        const url = editUrl(source, rawId, kind, detailHref);
        if (url) router.push(url);
        else toast.error(`No edit page for ${source} ${kind}`);
    };

    const startCancel = () => { setReason(""); setConfirmAction("cancel"); };
    const startDelete = () => { setReason(""); setConfirmAction("delete"); };

    const submitConfirm = async () => {
        if (!confirmAction) return;
        if (!reason.trim()) return;
        setBusy(true);
        try {
            await axios.post(`${apiBase(source, rawId)}/${confirmAction}`, {
                reason: reason.trim(),
            });
            toast.success(confirmAction === "cancel" ? "Voucher cancelled" : "Voucher deleted");
            setConfirmAction(null);
            onChanged?.();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? `Failed to ${confirmAction}`);
        } finally {
            setBusy(false);
        }
    };

    const duplicate = async () => {
        setBusy(true);
        try {
            const { data } = await axios.post<{ id: number; type: string; reference: string }>(
                `/api/inventory/vouchers/${rawId}/duplicate`,
            );
            const url = voucherUrl(data.type, data.id);
            toast.success(`Duplicated as ${data.reference}`);
            if (url) router.push(url);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? "Failed to duplicate");
        } finally {
            setBusy(false);
        }
    };

    const isCancel = confirmAction === "cancel";
    const title = isCancel ? `Cancel ${reference}?` : `Delete ${reference}?`;
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
                        aria-label={`Actions for ${reference}`}
                        title="Actions"
                    >
                        <MoreVertical className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={goEdit} disabled={busy}>
                        <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={startCancel} disabled={busy}>
                        <Ban className="size-4" /> Cancel
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={startDelete} disabled={busy}>
                        <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                    {source === "inv" && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => void duplicate()} disabled={busy}>
                                <Copy className="size-4" /> Duplicate
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog
                open={confirmAction != null}
                onOpenChange={(o) => { if (!o) setConfirmAction(null); }}
            >
                <DialogContent className="!max-w-md">
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{description}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label htmlFor="day-book-action-reason">Reason</Label>
                        <Input
                            id="day-book-action-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Required"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && reason.trim() && !busy) void submitConfirm();
                            }}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setConfirmAction(null)}
                            disabled={busy}
                        >
                            Back
                        </Button>
                        <Button
                            type="button"
                            variant={isCancel ? "default" : "destructive"}
                            onClick={() => void submitConfirm()}
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
