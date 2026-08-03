// Turn the nested account-group tree from /api/accountancy/account-groups into
// the flat, depth-tagged list GroupCombobox renders. Was copy-pasted in both
// the create and the edit ledger dialog; kept here so they share one copy.

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

/** A ledger's normal balance is inherited from its group's accounting nature. */
export function inheritedNormalBalance(type: GroupType): "Debit" | "Credit" {
    return type === "ASSET" || type === "EXPENSE" ? "Debit" : "Credit";
}
