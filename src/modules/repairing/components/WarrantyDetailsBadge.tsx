"use client";

import { useEffect, useRef, useState } from "react";
import WarrantyBadge from "./WarrantyBadge";
import { formatDate } from "@/shared/lib/format/formatDate";

// The bright warranty badge, made clickable: a tap opens a small popover with
// the recorded warranty details (ref, purchase date, void reason) so the header
// stays a single clean line while the detail is one click away.
interface Props {
    isWarranty: boolean;
    warrantyStatus: string;
    warrantyRef?: string | null;
    purchaseDate?: string | null;
    voidReason?: string | null;
}

const STATUS_TEXT: Record<string, string> = {
    CLAIMED: "Warranty claim recorded — give the rebate or a free bill manually at billing.",
    ACTIVE:  "Warranty confirmed — no charge to the customer.",
    VOID:    "Warranty voided — charge the customer normally.",
    NONE:    "Warranty flagged.",
};

export default function WarrantyDetailsBadge({ isWarranty, warrantyStatus, warrantyRef, purchaseDate, voidReason }: Props) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    if (!isWarranty) return null;

    return (
        <div ref={wrapRef} className="relative">
            <button type="button" onClick={() => setOpen((o) => !o)} className="cursor-pointer" aria-label="Warranty details">
                <WarrantyBadge isWarranty={isWarranty} warrantyStatus={warrantyStatus} className="px-3 py-1" />
            </button>
            {open && (
                <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-border bg-popover p-3 text-left shadow-lg">
                    <p className="text-xs text-foreground">{STATUS_TEXT[warrantyStatus] ?? STATUS_TEXT.NONE}</p>
                    <dl className="mt-2 space-y-1 text-xs">
                        {warrantyRef && (
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted-foreground">Ref</dt>
                                <dd className="font-medium text-foreground">{warrantyRef}</dd>
                            </div>
                        )}
                        {purchaseDate && (
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted-foreground">Purchased</dt>
                                <dd className="font-medium text-foreground">{formatDate(purchaseDate)}</dd>
                            </div>
                        )}
                        {warrantyStatus === "VOID" && voidReason && (
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted-foreground">Void reason</dt>
                                <dd className="font-medium text-red-600">{voidReason.replace(/_/g, " ")}</dd>
                            </div>
                        )}
                    </dl>
                </div>
            )}
        </div>
    );
}
