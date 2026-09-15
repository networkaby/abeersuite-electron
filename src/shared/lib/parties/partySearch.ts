// ── partySearch ───────────────────────────────────────────────────────────────
// Finding the customer standing at the counter.
//
// The cashier is not running a query. They half-remember something — a piece of
// the name, the locality — and they ask for the mobile. Every fragment they add
// must NARROW the list; none may break it. The moment one row is left they
// greet the customer by name. That is the whole job: fewer questions asked of
// someone already waiting.
//
// So this searches EVERYTHING the row displays. A row that shows
// "8486308647 · Abhayapuri,Duramari" and then refuses to be found by "dura" is
// just lying to the operator. Name, every phone, every email, address, ledger
// aliases and linked company names all go into one blob, and the shared
// matcher in `search/textScore` ranks it exactly the way the product box ranks
// a barcode — which is how "medhidura" (name + locality, run together) works
// for the same reason "papera4" does.

import { searchProducts, type ProductSearchResult } from "@/shared/lib/inventory";

/** Everything a party can be found by. Loose so both the cached row
 *  (`LocalPartyRow`) and a server lookup row satisfy it. */
export type PartySearchCandidate = {
    name: string;
    phones?: readonly string[] | null;
    emails?: readonly string[] | null;
    address?: string | null;
    aliases?: readonly string[] | null;
    linkedCompanies?: readonly { name: string }[] | null;
};

/**
 * Punctuation that separates words in the real world but not in `String.split`.
 *
 * Addresses arrive as "Abhayapuri,Duramari" and "H/No 12, Ward-3" — one "word"
 * as far as the matcher is concerned, which quietly costs every word-start
 * match inside it. Turning these into spaces is what lets "dura" rank as the
 * start of "duramari" rather than as debris in the middle of a longer string,
 * and it is what lets "medhidura" split cleanly into name + locality.
 *
 * `@ . - +` are deliberately NOT in here: they hold emails and phone shapes
 * together.
 */
const WORD_BREAKS = /[,;:|/\\()[\]{}\n\r\t]+/g;

/** One searchable blob per party — every field the dropdown displays, plus the
 *  ones it matches on but doesn't show (secondary phones, ledger aliases). */
export function partySearchText(p: PartySearchCandidate): string {
    const parts: string[] = [p.name];
    for (const x of p.phones ?? []) parts.push(x);
    for (const x of p.emails ?? []) parts.push(x);
    if (p.address) parts.push(p.address);
    for (const x of p.aliases ?? []) parts.push(x);
    for (const c of p.linkedCompanies ?? []) parts.push(c.name);
    return parts.join(" ").replace(WORD_BREAKS, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Fewest digits that make a token worth treating as part of a phone number.
 *  Below this a stray "12" in an address would drag every phone into the match. */
const MIN_PHONE_DIGITS = 3;

/**
 * Rewrite a pasted phone number into the shape phones are actually stored in.
 *
 * Phones are held as bare digits, so "+91 99540-12345" — the form that comes off
 * WhatsApp, a bill, or the customer's own dictation — matched NOTHING: the "+"
 * and the "-" meant the token was searched as if it were a name. Anything that
 * is digits plus phone punctuation becomes its digits, and an Indian country
 * code on an over-long number is dropped, because the stored number never has
 * one.
 *
 * Left alone otherwise: "a4" keeps its letter, and a 1–2 digit token stays as
 * typed so a house number in an address still behaves like text.
 */
function normalisePhoneToken(token: string): string | null {
    if (!/^[+\-.\d]+$/.test(token)) return null;
    const digits = token.replace(/\D/g, "");
    if (digits.length < MIN_PHONE_DIGITS) return null;
    if (digits.length > 10 && digits.startsWith("91")) return digits.slice(2);
    return digits;
}

/** Is this token made only of the characters a phone number is written with? */
const isPhoneish = (t: string) => /^[+\-.\d]+$/.test(t);

/** Below this a run of number-ish tokens is not a phone number being typed with
 *  spaces in it — it is a house number and a ward number in an address. */
const MIN_JOINED_PHONE_DIGITS = 6;

/**
 * Apply `normalisePhoneToken` across the query, leaving every other token be.
 *
 * Consecutive number-ish tokens are joined first, because a phone number is
 * dictated and pasted with spaces in it: "+91 8486308647" is one number in two
 * tokens, and treating "+91" separately left it matching nothing and dragged the
 * whole query down to guesses. Only joined when the run carries enough digits to
 * really be a phone, so "Ward 3" in an address stays two words.
 */
export function normalisePartyQuery(query: string): string {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    const out: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        if (!isPhoneish(tokens[i])) { out.push(tokens[i]); continue; }
        let j = i;
        while (j + 1 < tokens.length && isPhoneish(tokens[j + 1])) j++;
        const run = tokens.slice(i, j + 1);
        const joined = run.join("");
        const useJoined = run.length === 1 || joined.replace(/\D/g, "").length >= MIN_JOINED_PHONE_DIGITS;
        if (useJoined) out.push(normalisePhoneToken(joined) ?? joined);
        else for (const t of run) out.push(normalisePhoneToken(t) ?? t);
        i = j;
    }
    return out.join(" ");
}

/** Person and Company ids collide — the matcher needs one key per row. */
const rowKey = (p: { type: string; id: number }) => `${p.type}:${p.id}`;

/**
 * How many rows a party search shows.
 *
 * A display cap, nothing more. It used to double as a completeness signal — a
 * search that found this many stopped asking anywhere else, on the theory that a
 * full page could only be repeated. It could not: the pool that produced those
 * rows was smaller than the customer list, so a full page proved nothing except
 * that the pool was too small. The search now ranks the whole list
 * (`parties/partyCatalog`), which is the only thing that ever made a page of
 * eight worth trusting.
 */
export const MAX_HITS = 8;

export type PartyRow = PartySearchCandidate & {
    id: number;
    type: "customer" | "company";
    accountGroup?: string | null;
};

/**
 * Rank parties against what the cashier typed.
 *
 * Straight through to `searchProducts` — the policy is identical (real search
 * first, looser passes only when nothing genuine matched, guesses marked so the
 * dropdown can colour them) and having two copies of it was how the party box
 * drifted into being the weaker of the two search boxes in the first place.
 */
export function searchPartyRows<T extends PartyRow>(
    parties: readonly T[],
    query: string,
    opts: { group?: string | null; rows?: number; fallback?: boolean } = {},
): ProductSearchResult<T> {
    const pool = opts.group
        ? parties.filter((p) => p.accountGroup === opts.group)
        : parties;
    return searchProducts(pool, normalisePartyQuery(query), {
        rows: opts.rows ?? MAX_HITS,
        fallback: opts.fallback ?? true,
        text: partySearchText,
        id: rowKey,
    });
}

/**
 * Which field would best narrow this list — the next question to ask.
 *
 * With several people still matching, the cashier's next question should be the
 * one that actually splits them: "which area?" when they live in different
 * localities, "last four digits?" when they don't. Returns the field with the
 * most distinct values among the rows on screen, or null when one row (or none)
 * makes the question moot.
 */
export function separatingField(
    // `phone` as well as `phones`: a row straight off the wire carries only its
    // primary as a scalar, and reading the array alone would find no phones at
    // all and always answer "ask for the area".
    rows: readonly (PartySearchCandidate & { phone?: string | null })[],
): "address" | "phone" | null {
    if (rows.length < 2) return null;
    const distinct = (pick: (p: (typeof rows)[number]) => string | null | undefined) =>
        new Set(rows.map((r) => (pick(r) ?? "").trim().toLowerCase()).filter(Boolean)).size;

    const byAddress = distinct((p) => p.address);
    const byPhone = distinct((p) => p.phones?.[0] ?? p.phone);
    if (byAddress >= rows.length && byAddress > 1) return "address";
    if (byPhone > byAddress) return "phone";
    return byAddress > 1 ? "address" : byPhone > 1 ? "phone" : null;
}
