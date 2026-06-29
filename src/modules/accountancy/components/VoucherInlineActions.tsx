"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FooterToggle } from "@/modules/accountancy/components/FooterToggle";

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
    /** Whether to render the Save & Post button. Hidden for users who may create
     *  but not post — they keep only Save Draft. Defaults to true. */
    showSave?: boolean;
    /** Left slot: LifecycleActions block, built by the caller. */
    leftContent?: React.ReactNode;
    /** Render the "Print after save" checkbox (before the Save cluster). */
    showPrintToggle?: boolean;
    printAfterSave?: boolean;
    onPrintAfterSaveChange?: (v: boolean) => void;
    /** Render the "Thermal" checkbox (only shown while Print after save is on). */
    showThermalToggle?: boolean;
    thermal?: boolean;
    onThermalChange?: (v: boolean) => void;
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
    showSave = true,
    leftContent,
    showPrintToggle,
    printAfterSave,
    onPrintAfterSaveChange,
    showThermalToggle,
    thermal,
    onThermalChange,
}: VoucherInlineActionsProps) {
    return (
        <div className="flex items-center justify-end gap-2 flex-wrap">
            {leftContent && <div className="mr-auto">{leftContent}</div>}
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
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
                    {saving && <Loader2 size={14} className="animate-spin" />} Save Draft
                </Button>
            )}
            {showSave && (
                <Button
                    onClick={onSave}
                    disabled={saveDisabled ?? saving}
                    className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                >
                    {saving && <Loader2 size={14} className="animate-spin" />} {saveLabel}
                </Button>
            )}
        </div>
    );
}
