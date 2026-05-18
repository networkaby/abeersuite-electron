"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VoucherActionBarProps {
    onCancel: () => void;
    onSave: () => void;
    saving?: boolean;
    saveDisabled?: boolean;
    /** Defaults to "Save". Pass "Save Changes" in edit mode when appropriate. */
    saveLabel?: string;
    onSaveDraft?: () => void;
    saveDraftDisabled?: boolean;
    /** Whether to render the Save Draft button at all. */
    showSaveDraft?: boolean;
    /** Left slot: LifecycleActions + posted-repost note, built by the caller. */
    leftContent?: React.ReactNode;
    /** Extra buttons inserted before Cancel (e.g. Link Payment, Show Profit, Save & Print). */
    extraButtons?: React.ReactNode;
}

export function VoucherActionBar({
    onCancel,
    onSave,
    saving,
    saveDisabled,
    saveLabel = "Save",
    onSaveDraft,
    saveDraftDisabled,
    showSaveDraft,
    leftContent,
    extraButtons,
}: VoucherActionBarProps) {
    return (
        <div className="border-t border-border bg-card px-6 py-3 flex items-center gap-2 shrink-0">
            {leftContent}
            <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                {extraButtons}
                {showSaveDraft && (
                    <Button variant="outline" onClick={onSaveDraft} disabled={saveDraftDisabled ?? saving}>
                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Draft
                    </Button>
                )}
                <Button onClick={onSave} disabled={saveDisabled ?? saving}>
                    {saving && <Loader2 size={13} className="animate-spin mr-1" />} {saveLabel}
                </Button>
            </div>
        </div>
    );
}
