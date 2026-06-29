"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FooterToggle } from "@/modules/accountancy/components/FooterToggle";

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
    /** Whether to render the Save (finalise/post) button. Hidden for users who
     *  may create but not post — they keep only Save Draft. Defaults to true. */
    showSave?: boolean;
    /** Left slot: LifecycleActions + posted-repost note, built by the caller. */
    leftContent?: React.ReactNode;
    /** Extra buttons inserted before Cancel (e.g. Link Payment, Show Profit). */
    extraButtons?: React.ReactNode;
    /** Render the "Print after save" checkbox (before the Save cluster). */
    showPrintToggle?: boolean;
    printAfterSave?: boolean;
    onPrintAfterSaveChange?: (v: boolean) => void;
    /** Render the "Thermal" checkbox (only shown while Print after save is on). */
    showThermalToggle?: boolean;
    thermal?: boolean;
    onThermalChange?: (v: boolean) => void;
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
    showSave = true,
    leftContent,
    extraButtons,
    showPrintToggle,
    printAfterSave,
    onPrintAfterSaveChange,
    showThermalToggle,
    thermal,
    onThermalChange,
}: VoucherActionBarProps) {
    return (
        <div className="border-t border-border bg-card px-6 py-3 flex items-center gap-2 shrink-0">
            {leftContent}
            <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                {extraButtons}
                {showPrintToggle && (
                    <FooterToggle
                        label="Print after save"
                        checked={!!printAfterSave}
                        onChange={(v) => onPrintAfterSaveChange?.(v)}
                        disabled={saving}
                    />
                )}
                {showThermalToggle && printAfterSave && (
                    <FooterToggle
                        label="Thermal"
                        checked={!!thermal}
                        onChange={(v) => onThermalChange?.(v)}
                        disabled={saving}
                    />
                )}
                {showSaveDraft && (
                    <Button variant="outline" onClick={onSaveDraft} disabled={saveDraftDisabled ?? saving}>
                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Draft
                    </Button>
                )}
                {showSave && (
                    <Button onClick={onSave} disabled={saveDisabled ?? saving}>
                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} {saveLabel}
                    </Button>
                )}
            </div>
        </div>
    );
}
