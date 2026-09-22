/**
 * Where a party's profile lives, and what a resolved party link looks like.
 *
 * A voucher only ever stores `partyId` — a bare number — plus a `partyType`
 * that says "customer" / "supplier" / "account". That type is about the ROLE
 * the party played on the document, not about what kind of record it is, so it
 * can never tell a Person from a Company. Screens that guessed
 * `?personId=${partyId}` from it were wrong twice: a supplier that was always a
 * Company got a dead link, and so did anybody put through a conversion (see
 * `resolvePartyLinks` in ./partyLinkServer).
 *
 * So the kind is decided on the server, once, and the page is handed
 * `partyKind` + `partyEntityId` and simply spells the URL. This file is the
 * shared shape of that answer plus the one spelling of the URL; the lookup
 * itself is server-only and lives next door.
 */

/** Which table the party's live record sits in. */
export type PartyLinkKind = "person" | "company";

/** A party id resolved to a live record — what every register row carries. */
export type ResolvedPartyLink = {
    /** Person or Company, decided by lookup — never inferred from partyType. */
    kind: PartyLinkKind;
    /** Id of the LIVE record. Differs from the stored partyId after a conversion. */
    entityId: number;
    /** The party's ledger Account, which survives a conversion unchanged. */
    accountId: number | null;
};

/** The fields a list API attaches to each row so the page can build the link. */
export type PartyLinkFields = {
    partyKind:     PartyLinkKind | null;
    partyEntityId: number | null;
};

/** Empty link fields — a walk-in / account-type party with no profile to open. */
export const NO_PARTY_LINK: PartyLinkFields = { partyKind: null, partyEntityId: null };

/** Spread a resolved link (or nothing) onto a row as `partyKind` / `partyEntityId`. */
export function partyLinkFields(link: ResolvedPartyLink | null | undefined): PartyLinkFields {
    return link == null ? NO_PARTY_LINK : { partyKind: link.kind, partyEntityId: link.entityId };
}

/**
 * The party's profile page. `null` when there is nothing to open — a walk-in,
 * or a party whose record could not be resolved — so callers render plain text
 * instead of a link that goes nowhere.
 */
export function partyProfileHref(
    kind: PartyLinkKind | null | undefined,
    entityId: number | null | undefined,
): string | null {
    if (kind == null || entityId == null) return null;
    return `/office/customers/all?${kind}Id=${entityId}`;
}
