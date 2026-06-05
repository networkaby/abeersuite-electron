import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { ContactConflictError } from "@/modules/customer/lib/contactWrite";
import { handleApiError, parsePagination, validateRequest } from "@/shared/lib/api";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { phoneEmailSchema, gstSchema } from "@/shared/lib/schemas/commonSchemas";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";

// Multi-value `phones` / `emails` arrays default to []; the first entry is
// primary unless an entry explicitly carries `isPrimary: true` at the write site.
const createPersonSchema = phoneEmailSchema.merge(gstSchema).extend({
    name: z.string().trim().min(1, "Name is required"),
    address: z.string().trim().optional().or(z.literal("")),
    agreedToTerms: z.boolean().optional(),
    accountGroup: z.enum(["Sundry Debtors", "Sundry Creditors"]).optional(),
});

type LookupResult = {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    // Discriminator kept as "customer"/"company" for back-compat with existing
    // consumers (POS, QuickTicket, party pickers).
    type: "customer" | "company";
    accountId: number | null;
    linkedCompanies: { id: number; name: string; accountId: number | null }[];
};

async function lookupAccounts(
    term: string,
    group?: string,
    opts?: { wide?: boolean },
): Promise<LookupResult[]> {
    // When `group` is set (e.g. "Sundry Debtors" / "Sundry Creditors") we
    // restrict the hits to parties whose ledger sits under that group. Lets
    // CN / Sale pick only customers, DN / Purchase pick only suppliers.
    const accountGroupFilter = group
        ? { account: { is: { group: { is: { name: group } } } } }
        : {};

    // `wide` widens each token's match to address + email as well as name/phone.
    // Opt-in only — POS / QuickTicket / party pickers stay strict (name + phone)
    // so their results don't change. The Front Office helper search passes it so
    // a query like "rosy delhi" can pair a name token with an address token.
    const wide = opts?.wide ?? false;
    const tokenOr = (t: string) => ({
        OR: [
            { name: { contains: t, mode: "insensitive" as const } },
            { phones: { some: { phone: { contains: t } } } },
            ...(wide
                ? [
                    { address: { contains: t, mode: "insensitive" as const } },
                    { emails: { some: { email: { contains: t, mode: "insensitive" as const } } } },
                  ]
                : []),
        ],
    });

    // Split multi-word queries (e.g. "abeer 9954") into tokens and AND them —
    // each token must match name / phone (and, when `wide`, address / email).
    const tokens = term.trim().split(/\s+/).filter(Boolean);
    const tokenFilter = tokens.length <= 1
        ? tokenOr(term)
        : { AND: tokens.map(tokenOr) };

    const [persons, companies] = await Promise.all([
        prisma.person.findMany({
            where: {
                isActive: true,
                ...accountGroupFilter,
                ...tokenFilter,
            },
            include: {
                account: { select: { id: true } },
                phones: selectPrimaryPhone,
                emails: selectPrimaryEmail,
                companies: {
                    where: { unlinkedAt: null },
                    include: {
                        company: {
                            select: { id: true, name: true, account: { select: { id: true } } },
                        },
                    },
                },
            },
            take: 8,
            orderBy: { createdAt: "desc" },
        }),
        prisma.company.findMany({
            where: {
                isActive: true,
                ...accountGroupFilter,
                ...tokenFilter,
            },
            include: {
                account: { select: { id: true } },
                phones: selectPrimaryPhone,
                emails: selectPrimaryEmail,
            },
            take: 8,
            orderBy: { createdAt: "desc" },
        }),
    ]);

    return [
        ...persons.map(p => ({
            id: p.id,
            name: p.name,
            phone: p.phones[0]?.phone ?? null,
            email: p.emails[0]?.email ?? null,
            address: p.address ?? null,
            type: "customer" as const,
            accountId: p.account?.id ?? null,
            linkedCompanies: p.companies.map(lc => ({
                id: lc.company.id,
                name: lc.company.name,
                accountId: lc.company.account?.id ?? null,
            })),
        })),
        ...companies.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phones[0]?.phone ?? null,
            email: c.emails[0]?.email ?? null,
            address: c.address ?? null,
            type: "company" as const,
            accountId: c.account?.id ?? null,
            linkedCompanies: [] as { id: number; name: string; accountId: number | null }[],
        })),
    ].slice(0, 8);
}

// GET /api/person?phone=...&q=...&lookup=...&group=Sundry+Debtors|Sundry+Creditors
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone")?.trim();
    const q = searchParams.get("q")?.trim();
    const lookup = searchParams.get("lookup")?.trim();
    const group = searchParams.get("group")?.trim() || undefined;
    // Opt-in: also search address + email per token (Front Office helper search).
    const wide = searchParams.get("wide") === "1";
    const { take, page } = parsePagination(searchParams);

    try {
        if (phone) return NextResponse.json(await lookupAccounts(phone, group, { wide }));
        // lookup !== undefined means the param was explicitly passed (even if empty),
        // allowing ?lookup=&group=... to browse the full group list on focus.
        if (lookup !== undefined) return NextResponse.json(await lookupAccounts(lookup, group, { wide }));

        const persons = await prisma.person.findMany({
            where: {
                isActive: true,
                ...(q ? {
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { phones: { some: { phone: { contains: q } } } },
                        { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
                    ],
                } : {}),
            },
            orderBy: { createdAt: "desc" },
            take,
            skip: (page - 1) * take,
            include: {
                _count: { select: { companies: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                account: {
                    select: { id: true, _count: { select: { devices: true } } },
                },
            },
        });

        const normalised = persons.map(p => ({
            ...p,
            phone: p.phones[0]?.phone ?? null,
            email: p.emails[0]?.email ?? null,
            _count: {
                companies: p._count.companies,
                devices: p.account?._count?.devices ?? 0,
            },
        }));
        return NextResponse.json(normalised);
    } catch (error) {
        return handleApiError(error, "Failed to fetch people");
    }
}

// POST /api/person — create person + auto-create ledger account + contact rows
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, createPersonSchema);

    if (error) return error;
    const body = data;

    // GSTIN ↔ state-code integrity (Person has no separate textual state field
    // today; only gstStateCode). The validator still normalises and rejects
    // anyone trying to send a mismatched gstStateCode.
    const integrity = normaliseGstinState({
        gstin:        body.gstin,
        gstStateCode: body.gstStateCode,
    });
    if (!integrity.ok) {
        return NextResponse.json({ error: integrity.error }, { status: 400 });
    }

    // shippingStateCode: when sent, must be a known Indian state code.
    const shippingState = body.shippingStateCode?.trim() || "";
    if (shippingState && !isValidStateCode(shippingState)) {
        return NextResponse.json(
            { error: `Invalid shippingStateCode "${shippingState}". Expected a 2-digit GSTIN state code.` },
            { status: 400 },
        );
    }

    const phones = body.phones.filter(p => p.trim().length > 0);
    const emails = body.emails.filter(e => e.trim().length > 0);

    try {
        const person = await prisma.$transaction(async (tx) => {
            const p = await tx.person.create({
                data: {
                    name: body.name,
                    address: body.address || null,
                    agreedToTerms: body.agreedToTerms ?? false,
                    agreedAt: body.agreedToTerms ? new Date() : null,
                    gstin:             integrity.value.gstin || null,
                    gstStateCode:      integrity.value.gstStateCode || null,
                    gstRegType:        body.gstRegType ?? (integrity.value.gstin ? "REGULAR" : null),
                    shippingStateCode: shippingState || null,
                },
            });

            for (let i = 0; i < phones.length; i++) {
                await tx.phone.create({
                    data: { phone: phones[i], personId: p.id, isPrimary: i === 0 },
                });
            }
            for (let i = 0; i < emails.length; i++) {
                await tx.email.create({
                    data: { email: emails[i], personId: p.id, isPrimary: i === 0 },
                });
            }

            const groupName = body.accountGroup ?? ACCOUNT_GROUPS.SUNDRY_DEBTORS;
            const group = await tx.accountGroup.findFirst({
                where: { name: groupName },
                select: { id: true },
            });
            await tx.account.create({
                // creditLimit 0 = cash-only by default; credit is granted later
                // by setting an explicit positive limit on the account.
                data: { personId: p.id, name: p.name, groupId: group?.id ?? null, creditLimit: 0 },
            });
            return p;
        });

        const full = await prisma.person.findUnique({
            where: { id: person.id },
            include: {
                account: { select: { id: true } },
                phones: true,
                emails: true,
            },
        });

        return NextResponse.json(full, { status: 201 });
    } catch (error) {
        if (error instanceof ContactConflictError) {
            return NextResponse.json({ error: error.message, field: error.field }, { status: 409 });
        }
        // Duck-type instead of instanceof — across the rsc bundling boundary the
        // Prisma error class identity isn't guaranteed to match.
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
        return handleApiError(error, "Failed to create person");
    }
}
