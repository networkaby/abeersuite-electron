// Server-side loader for a customer's group pricing — see groupPricing.ts.
//
// One read answers everything the POS routes ask about a party's pricing:
// which automatic benefits it may get (tier / coupons / loyalty) and its
// group's price rules, already walked down the product-group tree.
//
//   • The customer's own noDiscount flag (Customer Quality) wins: no
//     benefits, and no group rebate either — only the MRP / print-price
//     starting prices survive, since those are not discounts.
//   • An inactive group is switched off: normal pricing, every benefit on.
//   • A walk-in / counter ledger (no person, no company) gets everything on.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    ALL_BENEFITS, NO_BENEFITS, expandGroupRules, pctPriceType,
    type GroupPricing, type GroupPriceType, type PartyBenefits,
} from "@/modules/pricing-strategy/lib/groupPricing";

type Db = Pick<typeof prisma, "account" | "invProductGroup">;

const partySelect = {
    noDiscount: true,
    customerGroup: {
        select: {
            isActive: true,
            allowTierDiscount: true,
            allowCoupons: true,
            allowLoyalty: true,
            priceRules: { select: { productGroupId: true, priceType: true, pct: true } },
        },
    },
} as const;

export type PartyPricing = {
    benefits: PartyBenefits;
    /** null = no group rules apply to this party. */
    pricing: GroupPricing | null;
};

export async function loadPartyPricing(db: Db, accountId: number | null | undefined): Promise<PartyPricing> {
    if (accountId == null) return { benefits: ALL_BENEFITS, pricing: null };
    const acct = await db.account.findUnique({
        where: { id: accountId },
        select: { person: { select: partySelect }, company: { select: partySelect } },
    });
    const party = acct?.person ?? acct?.company ?? null;
    if (!party) return { benefits: ALL_BENEFITS, pricing: null };

    const group = party.customerGroup?.isActive ? party.customerGroup : null;
    const noDiscount = party.noDiscount === true;
    const benefits: PartyBenefits = noDiscount ? NO_BENEFITS : group
        ? { tier: group.allowTierDiscount, coupons: group.allowCoupons, loyalty: group.allowLoyalty }
        : ALL_BENEFITS;

    const rules = (group?.priceRules ?? [])
        .map((r) => ({ productGroupId: r.productGroupId, priceType: r.priceType as GroupPriceType, pct: r.pct == null ? null : Number(r.pct) }))
        .filter((r) => !noDiscount || !pctPriceType(r.priceType));
    if (rules.length === 0) return { benefits, pricing: null };

    const groups = await db.invProductGroup.findMany({ select: { id: true, parentId: true } });
    const pricing = expandGroupRules(rules, new Map(groups.map((g) => [g.id, g.parentId])));
    return { benefits, pricing };
}
