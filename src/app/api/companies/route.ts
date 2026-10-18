import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { canonicalPhone, PhoneFormatError } from "@/shared/lib/format/phone";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";
import { loadPartyUnallocated } from "@/modules/accountancy/lib/billLink";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { phoneEmailSchema, gstSchema } from "@/shared/lib/schemas/commonSchemas";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { afterCursor, NAME_ORDER, nextBrowseCursor, parseBrowseCursor } from "@/shared/lib/parties/browsePage";
import { BROWSE_PAGE_SIZE } from "@/shared/lib/constants/paging";
import { aliasKeyOf } from "@/modules/accountancy/lib/accountAlias";

const createSchema = phoneEmailSchema.merge(gstSchema).extend({
    name: z.string().trim().min(1, "Company name is required"),
    address: z.string().trim().optional().or(z.literal("")),
    companyReg: z.string().trim().optional().or(z.literal("")),
    taxId: z.string().trim().optional().or(z.literal("")),
    accountGroup: z.enum(["Sundry Debtors", "Sundry Creditors"]).optional(),
});

// GET /api/companies?q=...
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    // A role without `customers:view:creditors` passes this to hide suppliers
    // (Sundry Creditors) from the browse list — debtors and un-grouped stay in.
    const hideCreditors = searchParams.get("hideCreditors") === "1";
    // Browse-only "Show inactive" toggle — see /api/person for the mirror.
    const includeInactive = searchParams.get("includeInactive") === "1";
    // See /api/person for why only Name-ascending paginates, opt-in.
    const paginate = searchParams.get("paginate") === "1";
    // Opt-in — see /api/person for why this is not on by default.
    const withLinkHint = searchParams.get("withLinkHint") === "1";
    const cursor = paginate ? parseBrowseCursor(searchParams) : null;

    try {
        const companies = await prisma.company.findMany({
            where: {
                AND: [
                    ...(includeInactive ? [] : [{ isActive: true }]),
                    ...(hideCreditors
                        ? [{ NOT: { account: { is: { group: { is: { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS } } } } } }]
                        : []),
                    ...(q ? [{
                        OR: [
                            { name: { contains: q, mode: "insensitive" as const } },
                            { phones: { some: { phone: { contains: q } } } },
                            { companyReg: { contains: q, mode: "insensitive" as const } },
                            // The ledger's Keywords (Profile tab) find the party, as in the voucher pickers.
                            { account: { is: { aliases: { some: { aliasKey: { contains: aliasKeyOf(q) } } } } } },
                        ],
                    }] : []),
                    ...(paginate ? [afterCursor(cursor)] : []),
                ],
            },
            orderBy: paginate ? NAME_ORDER : { createdAt: "desc" },
            ...(paginate ? { take: BROWSE_PAGE_SIZE } : {}),
            include: {
                _count: { select: { persons: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                account: {
                    select: {
                        id: true,
                        // No `balance` / `openingBalance*`: the figure this page
                        // shows is summed from the GL lines below, so reading the
                        // cached column here would only invite the two to disagree.
                        normalBalance: true,
                        // `name` + `aliases` cost nothing extra — same relation already
                        // joined for `type` — but let a search hit here also fill the
                        // till's party cache (see `aliases`/`accountGroup` below).
                        group: { select: { type: true, name: true } },
                        aliases: { select: { alias: true } },
                        _count: { select: { devices: true } },
                    },
                },
            },
        });

        // Balances come from the GL lines of just these parties, not from the
        // `Account.balance` cache. Each counter holds a full local replica, so
        // one narrowed aggregate over the accounts already on this page is a
        // cheap indexed read — and unlike the cache it cannot drift away from
        // the ledger the party's own statement is printed from.
        //
        // No date ceiling: this column means "what stands on the account", the
        // same total the cache carried, not a position as of today.
        const accountIds = companies.map(c => c.account?.id).filter((id): id is number => id != null);
        const [closing, unallocated] = await Promise.all([
            closingForAccounts(null, accountIds),
            withLinkHint ? loadPartyUnallocated(prisma, accountIds) : Promise.resolve(null),
        ]);

        const normalised = companies.map(c => ({
            ...c,
            phone: c.phones[0]?.phone ?? null,
            email: c.emails[0]?.email ?? null,
            _count: {
                customers: c._count.persons,
                devices: c.account?._count?.devices ?? 0,
            },
            account: c.account ? {
                id: c.account.id,
                balance: closing.get(c.account.id) ?? 0,
                normalBalance: c.account.normalBalance
                    ?? (c.account.group?.type ? defaultNormalBalanceForGroupType(c.account.group.type) : "DEBIT"),
                ...(unallocated ? { toLink: unallocated.get(c.account.id)?.toLink ?? 0 } : {}),
            } : null,
            // Cache-fill fields — not shown by this page, only what a search hit
            // here can hand the till's cache for free.
            aliases: c.account?.aliases.map(a => a.alias) ?? [],
            accountGroup: c.account?.group?.name ?? null,
            accountGroupType: c.account?.group?.type ?? null,
        }));
        // Opt-in envelope — see /api/person for why every other caller keeps
        // getting the plain array unchanged.
        return NextResponse.json(
            paginate ? { items: normalised, nextCursor: nextBrowseCursor(companies, BROWSE_PAGE_SIZE) } : normalised,
        );
    } catch (error) {
        return handleApiError(error, "Failed to fetch companies");
    }
}

// POST /api/companies — create company + auto-create ledger account + contact rows
//
// Open to any signed-in user, same as POST /api/person: PartySearchAndCreate
// creates a company party mid-billing (POS, vouchers, tickets), so gating on the
// Contacts page's `customers:create` blocked flows the role legitimately owns.
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    // GSTIN ↔ state-code integrity (Company has no separate textual state field).
    const integrity = normaliseGstinState({
        gstin:        body.gstin,
        gstStateCode: body.gstStateCode,
    });
    if (!integrity.ok) {
        return NextResponse.json({ error: integrity.error }, { status: 400 });
    }
    const shippingState = body.shippingStateCode?.trim() || "";
    if (shippingState && !isValidStateCode(shippingState)) {
        return NextResponse.json(
            { error: `Invalid shippingStateCode "${shippingState}". Expected a 2-digit GSTIN state code.` },
            { status: 400 },
        );
    }

    // Stored form per canonicalPhone; `+91…` and bare 10 digits are one number.
    const typedPhones = body.phones.filter(p => p.trim().length > 0);
    const badPhone = typedPhones.find(p => !canonicalPhone(p));
    if (badPhone) return handleApiError(new PhoneFormatError(badPhone));
    const phones = [...new Set(typedPhones.map(p => canonicalPhone(p)!))];
    const emails = body.emails.filter(e => e.trim().length > 0);

    try {
        const company = await prisma.$transaction(async (tx) => {
            const c = await tx.company.create({
                data: {
                    name: body.name,
                    address: body.address || null,
                    companyReg: body.companyReg || null,
                    taxId: body.taxId || null,
                    gstin:             integrity.value.gstin || null,
                    gstStateCode:      integrity.value.gstStateCode || null,
                    gstRegType:        body.gstRegType ?? (integrity.value.gstin ? "REGULAR" : null),
                    shippingStateCode: shippingState || null,
                },
            });

            for (let i = 0; i < phones.length; i++) {
                await tx.phone.create({
                    data: { phone: phones[i], companyId: c.id, isPrimary: i === 0 },
                });
            }
            for (let i = 0; i < emails.length; i++) {
                await tx.email.create({
                    data: { email: emails[i], companyId: c.id, isPrimary: i === 0 },
                });
            }

            const targetGroupName = body.accountGroup ?? ACCOUNT_GROUPS.SUNDRY_DEBTORS;
            const accountGroup = await tx.accountGroup.findFirst({
                where: { name: targetGroupName },
                select: { id: true },
            });
            await tx.account.create({
                // creditLimit 0 = cash-only by default; credit is granted later
                // by setting an explicit positive limit on the account.
                data: { companyId: c.id, name: c.name, groupId: accountGroup?.id ?? null, creditLimit: 0 },
            });
            return c;
        });

        const full = await prisma.company.findUnique({
            where: { id: company.id },
            include: {
                account: { select: { id: true } },
                phones: true,
                emails: true,
            },
        });

        return NextResponse.json(full, { status: 201 });
    } catch (error) {
        const e = error as { code?: string; meta?: { modelName?: string; target?: string[] | string } } | null;
        if (e?.code === "P2002") {
            const model = e.meta?.modelName?.toLowerCase();
            const tgt = Array.isArray(e.meta?.target) ? e.meta.target.join(",") : e.meta?.target;
            const isPhone = model === "phone" || (typeof tgt === "string" && tgt.includes("phone"));
            const isEmail = model === "email" || (typeof tgt === "string" && tgt.includes("email"));
            if (isPhone || isEmail) {
                const field = isPhone ? "phone" : "email";
                return NextResponse.json(
                    { error: `This ${field} is already used by another contact`, field },
                    { status: 409 },
                );
            }
        }
        return handleApiError(error, "Failed to create company");
    }
}
