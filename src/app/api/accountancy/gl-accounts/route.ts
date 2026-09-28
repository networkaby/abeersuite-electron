import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import {
    aggregateClosingAsOf, loadNormalBalanceMap,
} from "@/modules/accountancy/lib/aggregateLedger";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { canDepositToPartyBank, parsePartyBank } from "@/shared/lib/parties/partyBank";

const createSchema = z.object({
    name: z.string().trim().min(1),
    groupId: z.number().int().positive(),
    normalBalance: z.enum(["DEBIT", "CREDIT"]),
    description: z.string().trim().optional(),
    parentId: z.number().int().positive().optional(),
    // Opening balance written straight to the Account row; reports pick it
    // up via loadMasterOpeningBalances() in aggregateLedger.ts. Universal
    // opening — no date; always effective from the start of the books.
    openingBalance:     z.number().nonnegative().nullish(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullish(),
});

// GET /api/accountancy/gl-accounts
// Returns only pure GL accounts (no person/company identity linkage) by default.
// Optional `type` query param filters by the parent group's type
// (ASSET | LIABILITY | INCOME | EXPENSE).
// `includeParties=true` also returns party ledgers (person/company-linked
// accounts) — used by Receipt / Payment voucher dialogs that need to credit /
// debit a party balance directly.
export async function GET(req: Request) {
    // The account list is read by every voucher form (office + POS). Reads are
    // default-open for signed-in staff — no capability gate.
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const includeParties = searchParams.get("includeParties") === "true";

    try {
        const accounts = await prisma.account.findMany({
            where: {
                ...(includeParties ? {} : { personId: null, companyId: null }),
                ...(activeOnly ? { isActive: true } : {}),
                ...(type
                    ? { group: { type: type as "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" } }
                    : {}),
            },
            orderBy: [{ name: "asc" }],
            include: {
                parent: { select: { id: true, name: true } },
                group:  { select: { id: true, name: true, type: true } },
                // Alternate names — the combobox filters on them client-side.
                aliases: { select: { alias: true }, orderBy: { id: "asc" } },
                // Party ledgers only — lets the voucher combobox search a
                // Sundry Debtor / Creditor by mobile number, not just name.
                // bankJson → `partyBank` below.
                ...(includeParties ? {
                    person:  { select: { phones: { select: { phone: true, isPrimary: true } }, bankJson: true } },
                    company: { select: { phones: { select: { phone: true, isPrimary: true } }, bankJson: true } },
                } : {}),
                staffLedgerOf: { select: { bankJson: true } },
            },
        });
        // Truth-path closing from JournalLine (folds in master openings),
        // so the chart of accounts, voucher dropdowns and party combobox
        // all show numbers that match the Balance Sheet by construction.
        const nbMap = await loadNormalBalanceMap();
        const closingMap = await aggregateClosingAsOf(new Date(), nbMap);
        const accountsWithEffective = accounts.map((a) => {
            // Flatten the party's phones to a plain string[] (primary first) so
            // the client just filters/renders — person & company objects drop out.
            // Aliases flatten the same way — the client only ever wants the strings.
            const { person, company, staffLedgerOf, aliases, ...rest } = a as typeof a & {
                person?:  { phones: { phone: string; isPrimary: boolean }[]; bankJson: unknown } | null;
                company?: { phones: { phone: string; isPrimary: boolean }[]; bankJson: unknown } | null;
                aliases?: { alias: string }[];
            };
            const phones = [...(person?.phones ?? []), ...(company?.phones ?? [])]
                .sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary))
                .map((p) => p.phone);
            // Ledgers of a person, company or staff member only: can a cash
            // Payment be deposited straight into their bank? One flag, not the
            // details — the slip reads those at print time (partyDepositSlip.ts).
            const owner = person ?? company ?? staffLedgerOf ?? null;
            return {
                ...rest,
                phones,
                aliases: (aliases ?? []).map((x) => x.alias),
                balance: closingMap.get(a.id) ?? 0,
                ...(owner ? { partyBank: canDepositToPartyBank(parsePartyBank(owner.bankJson)) } : {}),
            };
        });
        return NextResponse.json(accountsWithEffective);
    } catch (e) {
        return handleApiError(e, "Failed to fetch GL accounts");
    }
}

// POST /api/accountancy/gl-accounts
// Account `type` is no longer stored on the row — it's derived from the parent
// group. Caller must pass `groupId`; `normalBalance` is required.
export async function POST(req: Request) {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    try {
        const account = await prisma.account.create({
            data: {
                name: body.name,
                groupId: body.groupId,
                normalBalance: body.normalBalance,
                description: body.description ?? null,
                parentId: body.parentId ?? null,
                openingBalance:     body.openingBalance ?? null,
                openingBalanceType: body.openingBalanceType ?? null,
                openingBalanceDate: null,
            },
        });
        return NextResponse.json(account, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create GL account");
    }
}
