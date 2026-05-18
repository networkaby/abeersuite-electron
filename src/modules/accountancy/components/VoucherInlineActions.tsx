"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VoucherInlineActionsProps {
    onCancel: () => void;
    onSave: () => void;
    saving?: boolean;
    saveDisabled?: boolean;
    /** Defaults to "Save & Post". */
    saveLabel?: string;
    onSaveDraft?: () => void;
    saveDraftDisabled?: boolean;
    showSaveDraft?: boolean;
    /** Left slot: LifecycleActions block, built by the caller. */
    leftContent?: React.ReactNode;
}

export function VoucherInlineActions({
    onCancel,
    onSave,
    saving,
    saveDisabled,
    saveLabel = "Save & Post",
    onSaveDraft,
    saveDraftDisabled,
    showSaveDraft,
    leftContent,
}: VoucherInlineActionsProps) {
    return (
        <div className="flex items-center justify-end gap-2 flex-wrap">
            {leftContent && <div className="mr-auto">{leftContent}</div>}
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            {showSaveDraft && (
                <Button variant="outline" onClick={onSaveDraft} disabled={saveDraftDisabled ?? saving}>
                    {saving && <Loader2 size={14} className="animate-spin" />} Save Draft
                </Button>
            )}
            <Button
                onClick={onSave}
                disabled={saveDisabled ?? saving}
                className="bg-green-600 hover:bg-green-700 text-white border-green-600"
            >
                {saving && <Loader2 size={14} className="animate-spin" />} {saveLabel}
            </Button>
        </div>
    );
}
