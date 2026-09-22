/**
 * Where a party's profile lives, and how a voucher names the party it was
 * raised against.
 *
 * A voucher stores two things: `partyId`, a bare number, and `partyType`.
 * Despite the name, `partyType` is not the role the party played — it is the
 * KIND of record, written straight from the party picker, whose only two
 * values are "customer" (a Person) and "company" (a Company). So the table is
 * always known from the row itself and never has to be looked up.
 *
 * What the row cannot tell you is whether that record is still the live one.
 * A conversion or a merge leaves the old id in place and forwards it (see
 * `resolvePartyLinks` in ./partyLinkServer), and that is the one question worth
 * a query.
 */

/** Which table the party's live record sits in. */
export type PartyLinkKind = "person" | "company";

/** How a voucher names its party — the stored id plus the kind that goes with it. */
export type PartyRef = {
    partyId:   number | null;
    /** "customer" = Person, "company" = Company. Anything else has no profile. */
    partyType: string | null;
};

/** A party reference resolved to the record that is live today. */
export type ResolvedPartyLink = {
    kind: PartyLinkKind;
    /** Id of the LIVE record — differs from the stored partyId after a conversion or merge. */
    entityId: number;
    /** The party's ledger Account. Only filled when the caller asked for it. */
    accountId: number | null;
};

/** The fields a list API attaches to each row so the page can build the link. */
export type PartyLinkFields = {
    partyKind:     PartyLinkKind | null;
    partyEntityId: number | null;
};

/** Empty link fields — a walk-in, or a party with no profile to open. */
export const NO_PARTY_LINK: PartyLinkFields = { partyKind: null, partyEntityId: null };

/**
 * The table behind a stored `partyType`.
 *
 * `null` for anything else — a walk-in (no party at all) or an "account"-type
 * row, which names a plain ledger head rather than a party, and so has no
 * customer profile to open.
 */
export function partyKindFromType(partyType: string | null | undefined): PartyLinkKind | null {
    if (partyType === "customer") return "person";
    if (partyType === "company")  return "company";
    return null;
}

/** Spread a resolved link (or nothing) onto a row as `partyKind` / `partyEntityId`. */
export function partyLinkFields(link: ResolvedPartyLink | null | undefined): PartyLinkFields {
    return link == null ? NO_PARTY_LINK : { partyKind: link.kind, partyEntityId: link.entityId };
}

/**
 * The party's profile page. `null` when there is nothing to open, so callers
 * render plain text instead of a link that goes nowhere.
 */
export function partyProfileHref(
    kind: PartyLinkKind | null | undefined,
    entityId: number | null | undefined,
): string | null {
    if (kind == null || entityId == null) return null;
    return `/office/customers/all?${kind}Id=${entityId}`;
}
