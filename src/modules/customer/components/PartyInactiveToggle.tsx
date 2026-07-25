"use client";

import { Checkbox } from "@/components/ui/checkbox";

interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** Only a customers:delete holder can reactivate one, so hide the toggle otherwise. */
    visible: boolean;
}

// "Show inactive" — lets someone who can reactivate a party actually find it;
// deactivated rows are hidden from the default list everywhere else.
export function PartyInactiveToggle({ checked, onChange, visible }: Props) {
    if (!visible) return null;

    return (
        <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
            Show inactive
        </label>
    );
}
