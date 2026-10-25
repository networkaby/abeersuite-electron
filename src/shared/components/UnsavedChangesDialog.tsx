"use client";

// The "Unsaved changes" popup every voucher page shows when the operator
// leaves a form that differs from where it started.
//
// Keys follow Tally: Esc on an untouched form closes it (the page's own
// useEscape); Esc on a changed form opens this popup; Esc here closes the
// popup and STAYS on the form — nothing is lost on a double press. Enter also
// stays (Radix focuses the first button). Leaving without saving is the
// explicit "Discard & Close" click.

import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export function UnsavedChangesDialog({ open, onOpenChange, onSaveDraft, onDiscard, saveDraftDisabled = false }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Save without posting. The popup closes first. */
    onSaveDraft: () => void | Promise<void>;
    /** Leave the form, dropping the changes. The popup closes first. */
    onDiscard: () => void;
    /** Same rule as the toolbar's Save Draft (e.g. an unbalanced journal). */
    saveDraftDisabled?: boolean;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Unsaved changes</DialogTitle>
                    <DialogDescription>
                        You have unsaved changes that will be lost if you leave now.
                        <br />
                        <span className="text-xs text-muted-foreground">Press Esc or Enter to stay.</span>
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Stay</Button>
                    <Button
                        variant="outline"
                        disabled={saveDraftDisabled}
                        onClick={async () => { onOpenChange(false); await onSaveDraft(); }}
                    >
                        Save Draft
                    </Button>
                    <Button variant="destructive" onClick={() => { onOpenChange(false); onDiscard(); }}>Discard &amp; Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
