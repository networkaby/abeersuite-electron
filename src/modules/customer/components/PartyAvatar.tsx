"use client";

import { groupColor } from "@/shared/lib/format/groupColor";
import { initials } from "@/shared/lib/format/initials";
import { cn } from "@/shared/lib/format/utils";

/** The square initials tile on a party list row.
 *
 *  The colour is derived from the name, so the same customer always gets the
 *  same tile and a long list can be scanned by colour before the eye reaches
 *  the text. Reuses the Trial-Balance group palette rather than inventing a
 *  second one — see groupColor. */
export function PartyAvatar({ name, className }: { name: string; className?: string }) {
    const tone = groupColor(name);
    return (
        <div
            className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-xs font-bold",
                tone.bg,
                tone.text,
                className,
            )}
        >
            {initials(name)}
        </div>
    );
}
