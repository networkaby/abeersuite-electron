/**
 * Is a search token even SHAPED like a phone or an email? Gates the exact-match
 * branches in party search (`lookupAccounts` server-side, `matches` in the
 * cache) — a token that cannot possibly equal a phone or an email has no
 * business being compared to one.
 *
 * Cheap on its own, but the real saving is upstream: the server only builds a
 * `phones`/`emails` OR-branch into the query when the token qualifies, so typing
 * a name never asks Postgres to scan phone or email columns at all. No shared
 * validation elsewhere in the codebase does exactly this — every existing phone
 * schema (`phoneEmailSchema` et al.) validates a value being SAVED, not
 * classifies a fragment being TYPED.
 */

/** Digits only, no separators — the shape `phones.phone` is stored in (see the
 *  "matched case-sensitively, digits" note in `partyCatalog.ts`). 3–15 digits:
 *  low enough that searching the last few digits of a phone still triggers the
 *  branch, high enough that a stray 1–2 digit token typed alongside a name
 *  (a quantity, a house number) does not. */
export function looksLikePhone(token: string): boolean {
    return /^\d{3,15}$/.test(token);
}

/** A plain shape check, not full RFC validation — good enough to tell "this
 *  could be an email" from "this is obviously a name token". */
export function looksLikeEmail(token: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token);
}
