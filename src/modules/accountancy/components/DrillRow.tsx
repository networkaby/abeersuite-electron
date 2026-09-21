"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";
import { groupReportUrl } from "@/modules/accountancy/lib/groupReportUrl";

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
        // Group and ledger URLs are built by their own builders, which attach
        // the period themselves — nothing to assemble here.
        switch (target.kind) {
            case "group":   return groupReportUrl(target.id, period);
            case "ledger":  return accountLedgerUrl(target.id, period);
            case "journal": return `/vouchers/journal-entries/${target.id}`;
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
