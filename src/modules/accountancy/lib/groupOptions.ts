// Turn the nested account-group tree from /api/accountancy/account-groups into
// the flat, depth-tagged list GroupCombobox renders. Was copy-pasted in both
// the create and the edit ledger dialog; kept here so they share one copy.

import axios from "axios";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

export interface GroupNode {
    id: number;
    name: string;
    type: GroupType;
    children: GroupNode[];
}

/** Shape GroupCombobox expects — `depth` drives its indent markers. */
export interface GroupOption {
    id: number;
    name: string;
    type: GroupType;
    depth: number;
}

/** Depth-first walk, preserving nesting depth so the picker can indent
 *  sub-groups under their parent. */
export function flattenGroups(nodes: GroupNode[], depth = 0, out: GroupOption[] = []): GroupOption[] {
    for (const n of nodes) {
        out.push({ id: n.id, name: n.name, type: n.type, depth });
        flattenGroups(n.children ?? [], depth + 1, out);
    }
    return out;
}

/** True when the group is Sundry Debtors / Sundry Creditors or any sub-group
 *  beneath them — the client-side twin of `partyLedgerIds`. Leans on
 *  flattenGroups' depth-first order: walking back up the list, the first row
 *  one level shallower is the parent. */
export function isPartyGroup(groups: GroupOption[], groupId: number | null): boolean {
    let i = groups.findIndex((g) => g.id === groupId);
    if (i < 0) return false;
    let depth = groups[i].depth;
    for (; i >= 0 && depth >= 0; i--) {
        if (groups[i].depth !== depth) continue;
        const name = groups[i].name;
        if (name === ACCOUNT_GROUPS.SUNDRY_DEBTORS || name === ACCOUNT_GROUPS.SUNDRY_CREDITORS) return true;
        depth--;
    }
    return false;
}

/** A ledger's normal balance is inherited from its group's accounting nature. */
export function inheritedNormalBalance(type: GroupType): "Debit" | "Credit" {
    return type === "ASSET" || type === "EXPENSE" ? "Debit" : "Credit";
}

// ── Cached group list ────────────────────────────────────────────────────────
// CreateLedgerDialog / EditLedgerDialog fetch the group tree when the caller
// hands them none. That was once per Masters visit; now that both dialogs open
// straight from a voucher's particulars box (Alt+C / Ctrl+Enter), the same tree
// would be re-read for every ledger anybody makes mid-entry. The tree changes
// perhaps a few times a year, so it is read ONCE per tab and kept here.
// Writers call `invalidateGroupOptions()` so the next open re-reads.

let cached: GroupOption[] | null = null;
let inFlight: Promise<GroupOption[]> | null = null;

/** Flat group list, fetched once per tab. Concurrent callers share one request. */
export function loadGroupOptions(): Promise<GroupOption[]> {
    if (cached) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = axios.get<GroupNode[]>("/api/accountancy/account-groups")
        .then((r) => { cached = flattenGroups(r.data); return cached; })
        .finally(() => { inFlight = null; });
    return inFlight;
}

/** Call after creating / renaming / deleting a group. */
export function invalidateGroupOptions(): void {
    cached = null;
}
