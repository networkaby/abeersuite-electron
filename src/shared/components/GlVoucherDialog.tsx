"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlVoucherPage, type MoneyFlowKind } from "@/modules/accountancy/components/GlVoucherPage";
import { JournalVoucherPage } from "@/modules/accountancy/components/JournalVoucherPage";
import type { ActiveParty } from "@/store/activePartyStore";

/** Voucher kinds the Quick Actions menus open in place. */
export type GlDialogKind = MoneyFlowKind | "JOURNAL";

/** Quick Action → dialog kind. Anything not listed keeps navigating. */
export const GL_DIALOG_KIND_BY_ACTION: Record<string, GlDialogKind> = {
    "new-payment":         "PAYMENT",
    "new-receipt":         "RECEIPT",
    "new-contra":          "CONTRA",
    "new-credit-note":     "CREDIT_NOTE",
    "new-debit-note":      "DEBIT_NOTE",
    "new-journal-voucher": "JOURNAL",
};

/**
 * The six GL voucher forms hosted over the office instead of navigating the
 * tab away (a left-click in Quick Actions; right-click still offers a new
 * window). The form is the same component the full page uses — it just gets
 * `onClose`, so Back / Cancel / Esc / after-save close this dialog.
 *
 * Esc and outside clicks are left to the form: it owns the "discard unsaved
 * changes?" prompt, and Radix closing underneath it would lose that.
 */
export default function GlVoucherDialog({ kind, onClose, initialParty = null }: {
    kind: GlDialogKind | null;
    onClose: () => void;
    /** The open customer profile, if any — lands in the form's party slot. */
    initialParty?: ActiveParty | null;
}) {
    return (
        <Dialog open={kind != null} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent
                showCloseButton={false}
                onEscapeKeyDown={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                className="flex h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
            >
                <DialogTitle className="sr-only">New voucher</DialogTitle>
                <DialogDescription className="sr-only">Fill in the voucher and save, or close to discard.</DialogDescription>
                {kind === "JOURNAL"
                    ? <JournalVoucherPage key="JOURNAL" onClose={onClose} />
                    : kind && <GlVoucherPage key={kind} kind={kind} onClose={onClose} initialParty={initialParty} />}
            </DialogContent>
        </Dialog>
    );
}
