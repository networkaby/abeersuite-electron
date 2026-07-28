"use client";

/**
 * "Cur Bal: 5,000.00 Dr" hint shown under an account picker in voucher
 * dialogs. Returns null when there's no account — callers can drop it in
 * unconditionally.
 */

import { formatBalanceWithSide, formatAvailable, type BalanceShaped } from "@/modules/accountancy/lib/balanceFormat";

export function BalanceHint({ account, className = "" }: {
    account: BalanceShaped | undefined | null;
    className?: string;
}) {
    if (!account) return null;
    const label = formatBalanceWithSide(account);
    const available = formatAvailable(account);
    return (
        <p className={`mt-0.5 pl-1 text-[11px] italic text-muted-foreground ${className}`}>
            Cur Bal: <span className="font-mono not-italic">{label}</span>
            {available != null && (
                <> · Available: <span className="font-mono not-italic">₹{available}</span></>
            )}
        </p>
    );
}
