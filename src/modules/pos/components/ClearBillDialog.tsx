"use client";

// ── ClearBillDialog ──────────────────────────────────────────────────────────
// Confirmation for the Shift+Esc "clear the whole bill" shortcut. Prevents an
// accidental wipe mid-bill: Esc / Cancel aborts, Clear empties the cart +
// all adjustments AND drops the customer — the cashier is switching to a
// completely different customer, so the register starts fresh.

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export function ClearBillDialog({
    open, onOpenChange, onConfirm,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onConfirm: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-sm"
                onOpenAutoFocus={(e) => {
                    // Pre-select "Clear bill" so Enter confirms instantly
                    // (Esc still cancels via the dialog).
                    e.preventDefault();
                    (e.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>("[data-clear-bill-confirm]")?.focus();
                }}
            >
                <DialogHeader>
                    <DialogTitle>Clear this bill?</DialogTitle>
                    <DialogDescription>
                        Removes all scanned items, discounts, adjustments and the selected
                        customer — ready to start a fresh bill with a new customer. This cannot
                        be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button variant="destructive" data-clear-bill-confirm onClick={onConfirm}>
                        <Trash2 size={14} /> Clear bill
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
