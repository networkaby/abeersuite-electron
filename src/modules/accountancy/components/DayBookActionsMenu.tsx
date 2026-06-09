"use client";

// Cross-source 3-dot row menu — used by the Day Book, the All Vouchers
// register, and (after the DRY migration) every per-kind voucher register.
//
// The menu shape depends on whether the row is soft-deleted:
//
//   • LIVE row (deletedAt == null):
//       Edit · Cancel · Delete · (Duplicate, all sources via client-side preload)
//
//   • DELETED row (deletedAt != null):
//       Restore · Hard Delete
//
// All four lifecycle actions hit `${apiBase}/<verb>` on the source's API
// (see voucherUrls.ts).  Duplicate is purely client-side: it stashes a
// payload in sessionStorage and navigates to the matching `/new` form —
// no DB row is created until the user explicitly hits Save.

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { MoreVertical, Pencil, Ban, Trash2, Copy, Undo2, AlertTriangle, Printer, FileText } from "lucide-react";
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
import { apiBase, referenceHref, receiptHref, type ReceiptVariant } from "@/modules/accountancy/lib/voucherUrls";
import { stashDuplicate, todayLocalISO, type DuplicateLine } from "@/modules/accountancy/lib/duplicate";

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
    rawId:      number;
    source:     CombinedSource;
    kind:       string;
    reference:  string;
    /** Soft-deleted? When set, the menu offers Restore + Hard Delete instead
     *  of Edit / Cancel / Delete / Duplicate. */
    deletedAt?: string | null;
    /** Fired after any successful action so the caller can reload. */
    onChanged?: () => void;
}

type ConfirmAction = "cancel" | "hard-delete" | null;

// ── Component ─────────────────────────────────────────────────────────────

export function DayBookActionsMenu({
    rawId, source, kind, reference, deletedAt, onChanged,
}: Props) {
    const router = useRouter();
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    const isDeleted = !!deletedAt;
    const base = apiBase(source, rawId);

    // ── Print / PDF (opens a print tab; user picks printer or "Save as PDF") ──
    const goPrint = (variant: ReceiptVariant) => {
        window.open(receiptHref(source, rawId, kind, variant), "_blank", "noopener");
    };

    // ── Edit ────────────────────────────────────────────────────────────────
    const goEdit = () => {
        const url = referenceHref(source, rawId, kind);
        if (url) router.push(url);
        else toast.error(`No edit page for ${source} ${kind}`);
    };

    // ── Cancel / Delete / Hard-Delete (reason dialog) ──────────────────────
    const startCancel     = () => { setReason(""); setConfirmAction("cancel"); };
    const startHardDelete = () => { setReason(""); setConfirmAction("hard-delete"); };

    const submitConfirm = async () => {
        if (!confirmAction) return;
        if (!reason.trim()) return;
        setBusy(true);
        try {
            await axios.post(`${base}/${confirmAction}`, { reason: reason.trim() });
            toast.success(confirmAction === "cancel" ? "Voucher cancelled" : "Voucher removed (in Recycle Bin)");
            setConfirmAction(null);
            onChanged?.();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? `Failed to ${confirmAction}`);
        } finally {
            setBusy(false);
        }
    };

    // ── Restore (no reason needed) ─────────────────────────────────────────
    const restore = async () => {
        setBusy(true);
        try {
            await axios.post(`${base}/restore`);
            toast.success("Voucher restored");
            onChanged?.();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? "Failed to restore");
        } finally {
            setBusy(false);
        }
    };

    // ── Duplicate (client-side preload, no DB write) ───────────────────────
    // Fetches the source voucher, strips identity fields, stashes the rest
    // in sessionStorage, and navigates to the matching /new form.  The form
    // hydrates from the stash on mount.  Reference is allocated only when
    // the user saves; abandoning the form = zero side effects.
    const duplicate = async () => {
        setBusy(true);
        try {
            // Fetch the source's GET payload (it's the same one the edit form
            // reads on mount).
            const { data } = await axios.get<{
                kind?:           string;
                type?:           string;
                narration?:      string | null;
                description?:    string | null;
                partyAccountId?: number | null;
                partyName?:      string | null;
                partyType?:      string | null;
                partyId?:        number | null;
                partyPhone?:     string | null;
                partyAddress?:   string | null;
                lines:           DuplicateLine[];
            }>(base);

            stashDuplicate({
                kind,
                date:           todayLocalISO(),
                narration:      data.narration ?? data.description ?? null,
                partyAccountId: data.partyAccountId ?? null,
                party: data.partyName != null ? {
                    name:    data.partyName,
                    type:    data.partyType ?? null,
                    id:      data.partyId ?? null,
                    phone:   data.partyPhone ?? null,
                    address: data.partyAddress ?? null,
                } : undefined,
                lines: data.lines ?? [],
            });

            const url = referenceHref(source, rawId, kind);
            // referenceHref points at the source's own [id] edit URL; we want
            // the /new path instead.  Translate by trimming the trailing /<id>
            // (works for both /vouchers/payments/123 and ?voucherId= URLs).
            const newUrl = newFormUrl(url, kind);
            if (newUrl) router.push(newUrl);
            else toast.error(`No create form for ${kind}`);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? "Failed to duplicate");
        } finally {
            setBusy(false);
        }
    };

    // ── Reason-dialog copy ──────────────────────────────────────────────────
    const dialogCopy = (() => {
        switch (confirmAction) {
            case "cancel":
                return {
                    title:       `Cancel ${reference}?`,
                    description: "Reverses GL impact via a counter-entry. The voucher remains visible but is marked CANCELLED.",
                    label:       "Confirm cancel",
                    variant:     "default" as const,
                };
            case "hard-delete":
                return {
                    title:       `Delete ${reference}?`,
                    description: "Removes the row and reverses any GL / stock impact. A full snapshot is kept in the Recycle Bin, so it can be restored later.",
                    label:       "Delete",
                    variant:     "destructive" as const,
                };
            default:
                return null;
        }
    })();

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
                <DropdownMenuContent align="end" className="w-48">
                    {/* Print / PDF — available for every voucher kind & state */}
                    <DropdownMenuItem onSelect={() => goPrint("thermal")} disabled={busy}>
                        <Printer className="size-4" /> Print (thermal)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => goPrint("pdf72")} disabled={busy}>
                        <FileText className="size-4" /> PDF 72mm
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => goPrint("pdfA4")} disabled={busy}>
                        <FileText className="size-4" /> PDF A4
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {isDeleted ? (
                        <>
                            <DropdownMenuItem onSelect={() => void restore()} disabled={busy}>
                                <Undo2 className="size-4" /> Restore
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={startHardDelete} disabled={busy}>
                                <AlertTriangle className="size-4" /> Hard Delete
                            </DropdownMenuItem>
                        </>
                    ) : (
                        <>
                            <DropdownMenuItem onSelect={goEdit} disabled={busy}>
                                <Pencil className="size-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={startCancel} disabled={busy}>
                                <Ban className="size-4" /> Cancel
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={startHardDelete} disabled={busy}>
                                <Trash2 className="size-4" /> Delete
                            </DropdownMenuItem>
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
                        <DialogTitle>{dialogCopy?.title}</DialogTitle>
                        <DialogDescription>{dialogCopy?.description}</DialogDescription>
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
                            variant={dialogCopy?.variant ?? "default"}
                            onClick={() => void submitConfirm()}
                            disabled={busy || !reason.trim()}
                        >
                            {busy ? "Working…" : (dialogCopy?.label ?? "Confirm")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

// Given an edit URL (e.g. /vouchers/payments/12 or /vouchers/sales/new?voucherId=12),
// return the corresponding fresh-create URL.  Used by Duplicate so the
// preloaded form opens at /new rather than /<id>.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function newFormUrl(editUrl: string | null, _kind: string): string | null {
    if (!editUrl) return null;
    // GL/JE pattern: /vouchers/<plural>/<id>  →  /vouchers/<plural>/new
    const glMatch = editUrl.match(/^(\/vouchers\/[^/?]+)\/\d+$/);
    if (glMatch) return `${glMatch[1]}/new`;
    // Inventory pattern: /vouchers/<plural>/new?voucherId=<id>  →  /vouchers/<plural>/new
    const invMatch = editUrl.match(/^(\/vouchers\/[^/?]+\/new)(\?.*)?$/);
    if (invMatch) return invMatch[1];
    return null;
}
