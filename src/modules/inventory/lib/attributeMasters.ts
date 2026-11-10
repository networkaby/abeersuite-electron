// Attribute masters ↔ groups (many-to-many, owner 2026-11-10). One place for the
// API row shape and for "which attributes does a product in group X get".

/** What the attribute-masters API includes to resolve its groups. */
export const ATTR_MASTER_INCLUDE = {
    groups: { select: { group: { select: { id: true, name: true } } } },
} as const;

export type AttrMasterApiRow = {
    id: number;
    key: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    /** Empty = global. Each group covers its subgroups. */
    groupIds: number[];
    groups: { id: number; name: string }[];
};

export function toAttrMasterRow(r: {
    id: number;
    key: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    groups: { group: { id: number; name: string } }[];
}): AttrMasterApiRow {
    const groups = r.groups.map((g) => g.group).sort((a, b) => a.name.localeCompare(b.name));
    return { id: r.id, key: r.key, name: r.name, sortOrder: r.sortOrder, isActive: r.isActive, groupIds: groups.map((g) => g.id), groups };
}

/**
 * Whether an attribute applies to a product in `groupId`: global (no groups),
 * or one of its groups is that group or an ancestor of it — a ticked parent
 * covers the whole subtree. `parentOf` walks the group tree.
 */
export function attrAppliesToGroup(
    attrGroupIds: number[],
    groupId: number | null,
    parentOf: (id: number) => number | null | undefined,
): boolean {
    if (attrGroupIds.length === 0) return true;
    const wanted = new Set(attrGroupIds);
    const seen = new Set<number>();
    for (let g = groupId; g != null && !seen.has(g); g = parentOf(g) ?? null) {
        if (wanted.has(g)) return true;
        seen.add(g);
    }
    return false;
}
