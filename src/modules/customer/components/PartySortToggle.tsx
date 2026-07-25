"use client";

import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PartySort, PartySortKey } from "@/modules/customer/lib/partySort";

const OPTIONS: { key: PartySortKey; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "balance", label: "Amount" },
];

interface Props {
    sort: PartySort;
    onChange: (sort: PartySort) => void;
}

// Click a key to sort by it; click the active one again to flip direction.
// Amount defaults to largest-first (desc), Name defaults A→Z (asc).
export function PartySortToggle({ sort, onChange }: Props) {
    const toggle = (key: PartySortKey) => {
        if (sort.key === key) {
            onChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
        } else {
            onChange({ key, dir: key === "balance" ? "desc" : "asc" });
        }
    };

    return (
        <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Sort</span>
            {OPTIONS.map((opt) => {
                const active = sort.key === opt.key;
                const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                    <Button
                        key={opt.key}
                        type="button"
                        size="xs"
                        variant={active ? "secondary" : "outline"}
                        onClick={() => toggle(opt.key)}
                    >
                        {opt.label}
                        {active && <Icon size={11} />}
                    </Button>
                );
            })}
        </div>
    );
}
