"use client";

// Cross-source 3-dot row menu — used by the Day Book, the All Vouchers
// register, and (after the DRY migration) every per-kind voucher register.
//
//   Edit · Cancel · Delete · Duplicate · Convert · Send on WhatsApp
//
// "Delete" is the ONE delete: it posts to `${apiBase}/hard-delete`, which removes
// the row and snapshots the whole graph to AuditLog = the Recycle Bin (restore via
// POST /api/audit/[id]/restore). There is no soft-delete tier — it was removed on
// 2026-08-01 along with this menu's Restore branch.
//
// Lifecycle actions hit `${apiBase}/<verb>` on the source's API (see
// voucherUrls.ts).  Duplicate is purely client-side: it stashes a payload in
// sessionStorage and navigates to the matching `/new` form — no DB row is
// created until the user explicitly hits Save.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { MoreVertical, Pencil, Ban, Trash2, Copy, Printer, FileText, ArrowRightLeft, MessageCircle } from "lucide-react";
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
import type { CombinedSource } from "@/modules/accountancy/hooks/useDayBook";
import { apiBase, referenceHref, receiptHref, type ReceiptVariant } from "@/modules/accountancy/lib/voucherUrls";
import { printVoucherThermal } from "@/shared/lib/print/silentThermalPrint";
import { stashDuplicate, todayLocalISO, type DuplicateLine } from "@/modules/accountancy/lib/duplicate";
import { convertTargets } from "@/modules/accountancy/lib/convertMap";
import { canActOnVoucher } from "@/shared/lib/auth/posVoucherMatrix";
import { autoKindForVoucherType, waSendHint } from "@/shared/lib/whatsapp/billTemplates";
import { sendOnWhatsApp, useWaSendStates } from "@/shared/hooks/useWhatsAppSend";

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
    rawId:      number;
    source:     CombinedSource;
    kind:       string;
    reference:  string;
    /** Already converted (a live voucher references it)? Hides the Convert action
     *  — delete that target to convert again. */
    converted?: boolean;
    /** Fired after any successful action so the caller can reload. */
    onChanged?: () => void;
}

type ConfirmAction = "cancel" | "hard-delete" | null;

// ── Component ─────────────────────────────────────────────────────────────

export function DayBookActionsMenu({
    rawId, source, kind, reference, converted, onChanged,
}: Props) {
    const router = useRouter();
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    const base = apiBase(source, rawId);

    // "Send on WhatsApp" — on every customer document; greyed out with the
    // reason until its template is approved and switched on (Settings →
    // WhatsApp Templates). A GL row's rawId is the spine id; an inventory
    // row's is its VoucherDetail id.
    const waKind = source !== "je" ? autoKindForVoucherType(kind) : null;
    const waStates = useWaSendStates();
    const waHint = waKind ? waSendHint(waStates[waKind]) : null;
    const canSendWa = waKind != null && waStates[waKind] === "ready";
    const sendWa = async () => {
        setBusy(true);
        await sendOnWhatsApp({ source: source === "gl" ? "uv" : "inv", id: rawId }).finally(() => setBusy(false));
    };

    // Edit, Cancel and Delete follow the Role page's ticks for this kind — the
    // same rule the server applies (canActOnVoucher): Cancel / edit for the
    // first two, Delete for the last.
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit   = canActOnVoucher(kind, "cancel", perms);
    const canDelete = canActOnVoucher(kind, "delete", perms);

    // ── The two print ways ───────────────────────────────────────────────────
    // "Print (thermal)" sends straight to the counter printer, like a POS sale —
    // no tab. Only when the counter cannot print silently (no printer set up,
    // bridge down, send failed) does the format-selection page open, on the
    // 80mm view. "Print / PDF" is always the selection page.
    const goPrint = async (variant: ReceiptVariant) => {
        if (variant === "thermal") {
            setBusy(true);
            await printVoucherThermal(source, rawId, kind).finally(() => setBusy(false));
            return;
        }
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
            toast.error(extractApiError(e, `Failed to ${confirmAction}`));
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
            toast.error(extractApiError(e, "Failed to duplicate"));
        } finally {
            setBusy(false);
        }
    };

    // ── Convert (generic voucher conversion) ───────────────────────────────
    // Only inventory documents convert (estimates / orders → next document); the
    // allowed targets come from the shared CONVERT_MAP. Posts nothing itself — the
    // convert API creates the target and returns its editable-form URL.
    const targets = source === "inv" && !converted ? convertTargets(kind) : [];
    const convert = async (targetKind: string) => {
        // POS sale rings up at the till — open it pre-filled from this source.
        if (targetKind === "POS") {
            router.push(`/vouchers/pos/new?fromVoucherId=${rawId}`);
            return;
        }
        setBusy(true);
        try {
            const { data } = await axios.post<{ editUrl: string | null; posted?: boolean; warning?: string | null }>(`${base}/convert`, { targetKind });
            if (data.warning) toast.warning(data.warning);
            else toast.success(data.posted ? "Converted & posted" : "Converted");
            // Stay in the current list (Day Book / register) and reload it — the new
            // posted voucher appears and the source flips to "Converted".
            onChanged?.();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Convert failed"));
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
                <DropdownMenuContent align="end" className="w-60">
                    {/* Print / PDF — available for every voucher kind & state */}
                    <DropdownMenuItem onSelect={() => void goPrint("thermal")} disabled={busy}>
                        <Printer className="size-4" /> Print (thermal)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void goPrint("pdf")} disabled={busy}>
                        <FileText className="size-4" /> Print / PDF
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
                    <DropdownMenuSeparator />
                    {canEdit && (
                        <DropdownMenuItem onSelect={goEdit} disabled={busy}>
                            <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                    )}
                    {canEdit && (
                        <DropdownMenuItem onSelect={startCancel} disabled={busy}>
                            <Ban className="size-4" /> Cancel
                        </DropdownMenuItem>
                    )}
                    {canDelete && (
                        <DropdownMenuItem variant="destructive" onSelect={startHardDelete} disabled={busy}>
                            <Trash2 className="size-4" /> Delete
                        </DropdownMenuItem>
                    )}
                    {(canEdit || canDelete) && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={() => void duplicate()} disabled={busy}>
                        <Copy className="size-4" /> Duplicate
                    </DropdownMenuItem>
                    {targets.length > 0 && (
                        <>
                            <DropdownMenuSeparator />
                            {targets.map((t) => (
                                <DropdownMenuItem key={t.kind} onSelect={() => void convert(t.kind)} disabled={busy}>
                                    <ArrowRightLeft className="size-4" /> Convert to {t.label}
                                </DropdownMenuItem>
                            ))}
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
