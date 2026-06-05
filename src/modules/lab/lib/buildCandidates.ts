/**
 * buildCandidates — Progressive customer identification scoring.
 *
 * Takes a list of people matches (from /api/person?lookup=), a list of
 * pre-loaded tickets (from /api/tickets), and the user's space-separated
 * query terms. Returns a deduplicated, scored list of customer candidates
 * where each candidate carries an *evidence trail* of what made them
 * match (name, phone, device on a ticket, problem description text).
 *
 * The function is pure, framework-free, and synchronous — easy to test and
 * trivial to migrate server-side in a future iteration (see plan iter 6).
 *
 * Map-key strategy: candidates from *both* the people-hit path and the
 * ticket path are keyed by `account-${accountId}` so they merge into one
 * row when the same account is reached by two independent signals. This
 * is the key to "name + device" combined scoring.
 */

// ── Public types ──────────────────────────────────────────────────────────

export type EvidenceTag =
    | { kind: "name";    matchedTerm: string }
    | { kind: "phone";   matchedTerm: string }
    | { kind: "email";   matchedTerm: string }
    | { kind: "address"; snippet: string }
    | { kind: "device";  brand: string; model: string; ticketId: string }
    | { kind: "problem"; snippet: string; ticketId: string };

export interface CustomerCandidate {
    /** null for ticket-only candidates (customer found via device history but no /api/person hit). */
    personId: number | null;
    accountId: number | null;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    type: "customer" | "company";
    evidence: EvidenceTag[];
    matchScore: number;
    /** Set of query terms this candidate has at least one evidence tag for. */
    termsCovered: Set<string>;
}

/** Shape this function reads from a ticket. Component's local TicketSearchRow is a superset. */
export interface TicketRow {
    id: string;
    device?: {
        type: string | null;
        brand: string | null;
        model: string | null;
        problem: string | null;
        account?: {
            id: number;
            name: string | null;
            phone?: string | null;
        } | null;
    } | null;
}

/** Shape this function reads from a /api/person lookup hit. PartyHit is a superset. */
export interface PartyHitInput {
    id: number;
    name: string;
    phone: string | null;
    email?: string | null;
    address?: string | null;
    type: "customer" | "company";
    accountId: number | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────

/** Build a stable map key. accountId wins; falls back to a person-scoped key. */
function makeKey(accountId: number | null, personId: number | null, type: "customer" | "company"): string {
    if (accountId != null) return `account-${accountId}`;
    if (personId != null) return `${type}-${personId}`;
    // No id at all — unique per call so we don't accidentally merge unrelated rows.
    return `anon-${Math.random()}`;
}

/** 40-char excerpt around the term match, trimmed. */
function snippetAround(text: string, lowerText: string, term: string): string {
    const idx = lowerText.indexOf(term);
    if (idx < 0) return text.slice(0, 40);
    const start = Math.max(0, idx - 15);
    const end   = Math.min(text.length, idx + term.length + 20);
    let s = text.slice(start, end).trim();
    if (start > 0) s = "…" + s;
    if (end < text.length) s = s + "…";
    return s;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * @param peopleHits  raw hits from usePartySearch (already-debounced /api/person)
 * @param allTickets  the full ticket list (loaded once on mount in UniversalHelperSearch)
 * @param queryTerms  the user's query split on whitespace, lowercased, length >= 2
 */
export function buildCandidates(
    peopleHits: PartyHitInput[],
    allTickets: TicketRow[],
    queryTerms: string[],
): CustomerCandidate[] {
    if (queryTerms.length === 0) return [];

    const map = new Map<string, CustomerCandidate>();

    // ── Step A — Seed candidates from people hits ─────────────────────────

    for (const p of peopleHits) {
        const key = makeKey(p.accountId, p.id, p.type);
        const candidate: CustomerCandidate = {
            personId: p.id,
            accountId: p.accountId,
            name: p.name,
            phone: p.phone,
            email: p.email ?? null,
            address: p.address ?? null,
            type: p.type,
            evidence: [],
            matchScore: 0,
            termsCovered: new Set<string>(),
        };

        const nameLower    = p.name.toLowerCase();
        const phonePlain   = (p.phone ?? "").replace(/\D/g, "");
        const emailLower   = (p.email ?? "").toLowerCase();
        const addressText  = p.address ?? "";
        const addressLower = addressText.toLowerCase();

        for (const term of queryTerms) {
            if (candidate.termsCovered.has(term)) continue;
            if (nameLower.includes(term)) {
                candidate.evidence.push({ kind: "name", matchedTerm: term });
                candidate.termsCovered.add(term);
            } else if (phonePlain.length > 0 && phonePlain.includes(term)) {
                candidate.evidence.push({ kind: "phone", matchedTerm: term });
                candidate.termsCovered.add(term);
            } else if (emailLower.length > 0 && emailLower.includes(term)) {
                candidate.evidence.push({ kind: "email", matchedTerm: term });
                candidate.termsCovered.add(term);
            } else if (addressLower.length > 0 && addressLower.includes(term)) {
                candidate.evidence.push({
                    kind: "address",
                    snippet: snippetAround(addressText, addressLower, term),
                });
                candidate.termsCovered.add(term);
            }
        }
        candidate.matchScore = candidate.termsCovered.size;

        // De-dup: if /api/person returned the same person twice (shouldn't, but safe), keep the higher-scored.
        const existing = map.get(key);
        if (!existing || candidate.matchScore > existing.matchScore) {
            map.set(key, candidate);
        }
    }

    // ── Step B — Walk tickets, attach evidence to existing or new candidates ─

    for (const t of allTickets) {
        const dev = t.device;
        if (!dev) continue;
        const acc = dev.account;
        if (!acc?.id) continue; // can't tie a candidate without an accountId

        const key = `account-${acc.id}`;
        let candidate = map.get(key);

        if (!candidate) {
            candidate = {
                personId: null,
                accountId: acc.id,
                name: acc.name ?? "Unknown",
                phone: acc.phone ?? null,
                email: null,
                address: null,
                type: "customer",
                evidence: [],
                matchScore: 0,
                termsCovered: new Set<string>(),
            };
            map.set(key, candidate);
        } else if (candidate.personId != null && (!candidate.phone) && acc.phone) {
            // Backfill phone from ticket if people hit didn't carry it.
            candidate.phone = acc.phone;
        }

        const deviceHaystack  = [dev.brand, dev.model, dev.type]
            .filter((x): x is string => Boolean(x))
            .join(" ")
            .toLowerCase();
        const problemText     = dev.problem ?? "";
        const problemHaystack = problemText.toLowerCase();

        // Account name also a clue (e.g. typed "peter" but no /api/person hit found him yet)
        const accNameLower = (acc.name ?? "").toLowerCase();

        for (const term of queryTerms) {
            if (candidate.termsCovered.has(term)) continue;

            if (accNameLower.includes(term)) {
                candidate.evidence.push({ kind: "name", matchedTerm: term });
                candidate.termsCovered.add(term);
                continue;
            }

            if (deviceHaystack.length > 0 && deviceHaystack.includes(term)) {
                candidate.evidence.push({
                    kind: "device",
                    brand: dev.brand ?? "",
                    model: dev.model ?? "",
                    ticketId: t.id,
                });
                candidate.termsCovered.add(term);
                continue;
            }

            if (problemHaystack.length > 0 && problemHaystack.includes(term)) {
                candidate.evidence.push({
                    kind: "problem",
                    snippet: snippetAround(problemText, problemHaystack, term),
                    ticketId: t.id,
                });
                candidate.termsCovered.add(term);
            }
        }

        candidate.matchScore = candidate.termsCovered.size;
    }

    // ── Step C — Filter (must match ≥1 term) and sort ─────────────────────

    const out = Array.from(map.values()).filter(c => c.matchScore > 0);
    out.sort((a, b) =>
        b.matchScore - a.matchScore
        || a.name.localeCompare(b.name)
    );
    return out;
}

/** Convenience: parse a raw query into terms suitable for buildCandidates. */
export function toQueryTerms(rawQuery: string): string[] {
    return rawQuery
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length >= 2);
}
