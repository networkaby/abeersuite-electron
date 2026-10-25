import type { GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { ACCOUNT_LEDGERS } from "@/shared/lib/constants/accounting";

// ── Default "Received In" tender account ─────────────────────────────────────
// Which cash/bank ledger a NEW voucher opens with. Called by BOTH the first-mount
// effect and reset()-after-save: reset() used to run its own arbitrary
// `.find(Cash-in-Hand)` instead, so saving a voucher silently snapped the picker
// back to whichever till the DB happened to return first (a counter till) even
// though the operator had chosen another one. Same resolver both paths = the pick
// survives save-and-continue, not just a fresh page load.
//
// Two rungs, deliberately: the account last used on this voucher kind (the
// localStorage key is per-kind, so a Sale's bank pick can't leak into Purchase),
// else the Tally-standard Petty Cash ledger — matched by EXACT name, since that
// name is fixed and bootstrap-seeded. Nothing after that: the old Vault /
// first-Cash-in-Hand fallbacks resolved to an ARBITRARY counter till, because the
// list came back in no order anyone chose. An empty picker the operator must fill
// is better than a confidently wrong till.
// `list` is already money ledgers only (isMoneyGroupName), so no group check.
export function pickDefaultTenderAccount(list: GlAccount[], storageKey: string): GlAccount | null {
    let lastId: number | null = null;
    try {
        const raw = window.localStorage.getItem(storageKey);
        lastId = raw ? Number(raw) : null;
    } catch { /* ignore — private mode / storage disabled */ }
    return (lastId != null ? list.find((a) => a.id === lastId) : undefined)
        ?? list.find((a) => a.name === ACCOUNT_LEDGERS.PETTY_CASH)
        ?? null;
}
