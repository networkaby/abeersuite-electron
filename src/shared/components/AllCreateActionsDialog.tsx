"use client";

import Link from "next/link";
import { Grid2x2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { MODULE_SECTIONS, type ModuleCreateAction } from "@/utils/constants";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { useCreateDialogStore } from "@/store/createDialogStore";
import { useJournalVoucherStore } from "@/store/journalVoucherStore";
import { useDebitNoteDialogStore } from "@/store/debitNoteDialogStore";
import { useContraDialogStore } from "@/store/contraDialogStore";
import { usePaymentDialogStore } from "@/store/paymentDialogStore";
import { useReceiptDialogStore } from "@/store/receiptDialogStore";
import { useCreditNoteDialogStore } from "@/store/creditNoteDialogStore";
// Sale uses the full-page /sale route now — no dialog store.
// Purchase uses the full-page /purchase route now — no dialog store.
import { useEstimateDialogStore } from "@/store/estimateDialogStore";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    permissions: string[];
    isAdmin: boolean;
    defaultPipeline: { id: string } | null;
};

export default function AllCreateActionsDialog({ open, onOpenChange, permissions, isAdmin, defaultPipeline }: Props) {
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();
    const { setPersonOpen, setCompanyOpen } = useCreateDialogStore();
    const { setOpen: openJournalVoucher } = useJournalVoucherStore();
    const { setOpen: openDebitNote } = useDebitNoteDialogStore();
    const { setOpen: openContra } = useContraDialogStore();
    const { setOpen: openPayment } = usePaymentDialogStore();
    const { setOpen: openReceipt } = useReceiptDialogStore();
    const { setOpen: openCreditNote } = useCreditNoteDialogStore();
    const { setOpen: openEstimate } = useEstimateDialogStore();

    const canDo = (permission?: string | null) => {
        if (!permission) return true;
        return isAdmin || permissions.includes(permission);
    };

    const handleAction = (action: ModuleCreateAction) => {
        if (action.disabled) return;
        onOpenChange(false);
        if (action.action === "new-ticket" && action.pipelineRef === "default" && defaultPipeline) {
            setInitialPipelineId(defaultPipeline.id);
            openQuickTicket(true);
        } else if (action.action === "new-person") {
            setPersonOpen(true);
        } else if (action.action === "new-company") {
            setCompanyOpen(true);
        } else if (action.action === "new-journal-voucher") {
            openJournalVoucher(true);
        } else if (action.action === "new-debit-note") {
            openDebitNote(true);
        } else if (action.action === "new-contra") {
            openContra(true);
        } else if (action.action === "new-payment") {
            openPayment(true);
        } else if (action.action === "new-receipt") {
            openReceipt(true);
        } else if (action.action === "new-credit-note") {
            openCreditNote(true);
        } else if (action.action === "new-sale") {
            // Open Sale Invoice in a new window so it surfaces in front
            // and the user can keep this dialog's parent tab on whatever
            // they were doing.
            window.open("/sale", "_blank", "noopener");
            onOpenChange(false);
        } else if (action.action === "new-purchase") {
            window.open("/purchase", "_blank", "noopener");
            onOpenChange(false);
        } else if (action.action === "new-sale-return") {
            window.open("/sale-return", "_blank", "noopener");
            onOpenChange(false);
        } else if (action.action === "new-purchase-return") {
            window.open("/purchase-return", "_blank", "noopener");
            onOpenChange(false);
        } else if (action.action === "new-estimate") {
            openEstimate(true);
        }
    };

    const modulesWithActions = MODULE_SECTIONS.filter(
        (m) => m.createActions && m.createActions.some((a) => canDo(a.permission))
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[85vh] max-h-[85vh] w-[95vw] max-w-[95vw] flex-col gap-0 p-0 sm:max-w-3xl">
                <DialogHeader className="border-b border-border px-5 py-3">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Grid2x2 size={16} />
                        All Create Actions
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Browse every creation action grouped by module. Click an item to open the form.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 min-h-0">
                    <div className="space-y-5 px-5 py-4">
                        {modulesWithActions.map((mod, idx) => {
                            const visibleActions = (mod.createActions ?? []).filter((a) => canDo(a.permission));
                            if (!visibleActions.length) return null;

                            const ModIcon = mod.icon;

                            return (
                                <div key={mod.key}>
                                    {idx > 0 && <div className="mb-5 -mx-5 border-t border-border/50" />}
                                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        <ModIcon size={12} />
                                        {mod.label}
                                    </div>
                                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                        {visibleActions.map((action) => {
                                            const Icon = action.icon;
                                            const isPrimary = action.variant === "default";
                                            const tooltip = `${action.label} — ${action.subtitle}`;

                                            const inner = (
                                                <div className="flex h-full items-center gap-2.5 px-3 py-2">
                                                    <div className={[
                                                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm",
                                                        isPrimary
                                                            ? "bg-primary text-primary-foreground"
                                                            : "bg-muted text-muted-foreground",
                                                    ].join(" ")}>
                                                        <Icon size={13} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium leading-tight text-foreground">
                                                            {action.label}
                                                        </div>
                                                        <div className="truncate text-[11px] leading-tight text-muted-foreground">
                                                            {action.subtitle}
                                                        </div>
                                                    </div>
                                                </div>
                                            );

                                            const baseClass = "block rounded-md border border-border/70 bg-card transition-colors hover:border-primary/30 hover:bg-muted";

                                            if (action.href && !action.disabled) {
                                                return (
                                                    <Link
                                                        key={action.label}
                                                        href={action.href}
                                                        title={tooltip}
                                                        onClick={() => onOpenChange(false)}
                                                        className={baseClass}
                                                    >
                                                        {inner}
                                                    </Link>
                                                );
                                            }

                                            return (
                                                <button
                                                    key={action.label}
                                                    type="button"
                                                    title={tooltip}
                                                    disabled={action.disabled}
                                                    onClick={() => handleAction(action)}
                                                    className={`${baseClass} w-full text-left ${action.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                                                >
                                                    {inner}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <ScrollBar orientation="vertical" />
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
