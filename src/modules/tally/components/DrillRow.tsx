"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

export type DrillTarget =
    | { kind: "group";    id: number }
    | { kind: "ledger";   id: number }
    | { kind: "journal";  id: number }
    | { kind: "voucher";  url: string }
    | { kind: "none" };

export interface DrillRowProps {
    target: DrillTarget;
    period?: { from?: string; to?: string; asOf?: string };
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
}

/** Shared clickable row used in Balance Sheet, P&L, Trial Balance, and Day Book.
 *  Resolves target → URL, attaches period query params for context propagation. */
export function DrillRow({ target, period, children, className = "", onClick }: DrillRowProps) {
    const router = useRouter();

    const url = useMemo(() => {
        const qs = new URLSearchParams();
        if (period?.from) qs.set("from", period.from);
        if (period?.to)   qs.set("to",   period.to);
        if (period?.asOf) qs.set("asOf", period.asOf);
        const q = qs.toString();
        const tail = q ? `?${q}` : "";

        switch (target.kind) {
            case "group":   return `/office/finance/groups/${target.id}${tail}`;
            case "ledger":  return `/office/finance/account/${target.id}${tail}`;
            case "journal": return `/office/finance/journal-entries/${target.id}`;
            case "voucher": return target.url;
            case "none":    return null;
        }
    }, [target, period]);

    const clickable = url !== null;

    return (
        <tr
            className={`${clickable ? "cursor-pointer hover:bg-muted/40" : ""} ${className}`}
            onClick={() => {
                if (onClick) { onClick(); return; }
                if (url) router.push(url);
            }}
        >
            {children}
        </tr>
    );
}
