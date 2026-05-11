"use client";

/**
 * Standard footer for voucher dialogs (Contra, Journal, Debit Note, …):
 * Cancel · Save Draft · Save & Post.
 *
 * Buttons share the same shape across dialogs — same disabled state, same
 * loading spinner placement, same primary-green colour for "& Post".
 */

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VoucherDialogFooter({
    saving,
    canSubmit = true,
    onCancel,
    onSaveDraft,
    onSavePost,
}: {
    saving: boolean;
    /** Disables Save Draft + Save & Post (typically when the form is incomplete). */
    canSubmit?: boolean;
    onCancel: () => void;
    onSaveDraft: () => void;
    onSavePost: () => void;
}) {
    const disabled = saving || !canSubmit;
    return (
        <div className="flex justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button variant="outline" onClick={onSaveDraft} disabled={disabled}>
                {saving && <Loader2 size={14} className="mr-1 animate-spin" />} Save Draft
            </Button>
            <Button
                onClick={onSavePost}
                disabled={disabled}
                className="border-green-600 bg-green-600 text-white hover:bg-green-700"
            >
                {saving && <Loader2 size={14} className="mr-1 animate-spin" />} Save &amp; Post
            </Button>
        </div>
    );
}
