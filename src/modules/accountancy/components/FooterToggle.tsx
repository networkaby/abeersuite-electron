"use client";

import { Checkbox } from "@/components/ui/checkbox";

// Compact labeled checkbox shared by both voucher footers (VoucherActionBar +
// VoucherInlineActions). Used for the "Print after save" and "Thermal" soft
// toggles. State lives in the form; this is purely presentational.
export function FooterToggle({
    label,
    checked,
    onChange,
    disabled,
}: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <label className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
                checked={checked}
                onCheckedChange={(v) => onChange(v === true)}
                disabled={disabled}
                aria-label={label}
            />
            {label}
        </label>
    );
}
