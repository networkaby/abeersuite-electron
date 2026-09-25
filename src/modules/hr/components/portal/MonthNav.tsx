"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { todayIso } from "@/shared/lib/format/formatDate";
import { monthLabel, shiftMonth } from "../MyTargetCard";

/** Previous / next month. Stops at the current month — a month that has not happened has nothing to say. */
export default function MonthNav({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
    const atLatest = month >= todayIso().slice(0, 7);
    return (
        <div className="flex items-center gap-1">
            <Button type="button" size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}>
                <ChevronLeft size={14} />
            </Button>
            <span className="min-w-36 text-center text-sm font-medium">{monthLabel(month)}</span>
            <Button type="button" size="icon-sm" variant="outline" aria-label="Next month" disabled={atLatest} onClick={() => onMonth(shiftMonth(month, 1))}>
                <ChevronRight size={14} />
            </Button>
        </div>
    );
}
