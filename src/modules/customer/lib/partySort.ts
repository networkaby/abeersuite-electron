export type PartySortKey = "name" | "balance";
export interface PartySort {
    key: PartySortKey;
    dir: "asc" | "desc";
}

export const DEFAULT_PARTY_SORT: PartySort = { key: "name", dir: "asc" };

/** Sort a party list panel (Person / Company / All) by name or ledger balance. */
export function sortParties<T>(
    items: T[],
    sort: PartySort,
    accessors: { name: (item: T) => string; balance: (item: T) => number },
): T[] {
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
        if (sort.key === "name") return accessors.name(a).localeCompare(accessors.name(b)) * mul;
        return (accessors.balance(a) - accessors.balance(b)) * mul;
    });
}
