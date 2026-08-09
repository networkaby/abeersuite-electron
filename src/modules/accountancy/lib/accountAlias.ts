// Ledger aliases (Tally-style alternate names) — one place for the parsing,
// normalisation and matching rules shared by the ledger routes, the ledger
// dialogs and the account comboboxes.
//
// Storage lives in AccountAlias: `alias` as typed, `aliasKey` lowercased and
// uniquely indexed. Everything that writes an alias must go through
// aliasRows() so those two columns can never drift apart.

/** Longest alias we store — mirrors AccountAlias.alias @db.VarChar(200). */
export const ALIAS_MAX_LENGTH = 200;

/** Lowercased, whitespace-collapsed form of an alias — the uniqueness key. */
export function aliasKeyOf(alias: string): string {
    return alias.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Split the comma-separated alias field of the ledger dialogs into clean,
 * de-duplicated aliases. Blanks are dropped; the first spelling of a repeated
 * alias wins, so typing "SBI, sbi" stores one row, not a unique-constraint error.
 */
export function parseAliasInput(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(",")) {
        const alias = part.trim().replace(/\s+/g, " ").slice(0, ALIAS_MAX_LENGTH);
        if (!alias) continue;
        const key = aliasKeyOf(alias);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(alias);
    }
    return out;
}

/** Join stored aliases back into the comma-separated dialog field. */
export function formatAliasInput(aliases: string[]): string {
    return aliases.join(", ");
}

/** Rows for a nested `aliases: { create: … }` write. Same de-dup as the parser. */
export function aliasRows(aliases: string[]): { alias: string; aliasKey: string }[] {
    return parseAliasInput(aliases.join(",")).map((alias) => ({
        alias,
        aliasKey: aliasKeyOf(alias),
    }));
}

/** True when any alias contains the (already lowercased) query — client-side pickers. */
export function aliasMatches(aliases: string[] | undefined, query: string): boolean {
    return (aliases ?? []).some((a) => a.toLowerCase().includes(query));
}
