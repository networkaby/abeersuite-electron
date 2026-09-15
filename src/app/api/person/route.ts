import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { ContactConflictError } from "@/modules/customer/lib/contactWrite";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { effectiveAccountBalance } from "@/modules/accountancy/lib/balance";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { phoneEmailSchema, gstSchema } from "@/shared/lib/schemas/commonSchemas";
import { afterCursor, BROWSE_PAGE_SIZE, NAME_ORDER, nextBrowseCursor, parseBrowseCursor } from "@/shared/lib/parties/browsePage";
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

// GET /api/person?q=...&hideCreditors=1&includeInactive=1&paginate=1
//
// The browse list behind the Contacts page. There is deliberately no typeahead
// branch here any more: every party picker in the app searches the whole party
// list in memory (see shared/lib/parties/partyCatalog), which it gets from
// /api/parties/catalog. A per-keystroke SQL endpoint could only ever offer
// `contains` over the eight newest matches, and cutting before ranking is what
// hid older customers from the till.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    // Supplier filter — a role without `customers:view:creditors` passes this to
    // drop parties in the Sundry Creditors group.
    const hideCreditors = searchParams.get("hideCreditors") === "1";
    // Browse-only "Show inactive" toggle — Trash-lite: lets a customers:delete
    // holder find and reactivate a previously deactivated party.
    const includeInactive = searchParams.get("includeInactive") === "1";
    // Explicit opt-in, sent only for the one view this paginates — name
    // ascending. Everything else (name descending, amount either way) falls
    // through to a single unbounded, client-sorted fetch exactly as before; see
    // browsePage.ts for why a computed balance has no cursor to walk, and
    // browsePage.ts's alphabetical-only contract for why descending doesn't
    // either (a forward cursor can't walk backward without becoming a second
    // code path for a rarer view).
    const paginate = searchParams.get("paginate") === "1";
    const cursor = paginate ? parseBrowseCursor(searchParams) : null;

    try {
        const persons = await prisma.person.findMany({
            where: {
                AND: [
                    // "Show inactive" surfaces plain deactivated parties only — merge/convert
                    // tombstones stay exclusively in the Customer Tools Trash, their own
                    // recovery path (hard-delete, not reactivate-in-place).
                    includeInactive
                        ? { OR: [
                            { isActive: true },
                            { isActive: false, mergedIntoPersonId: null, convertedToCompanyId: null },
                        ] }
                        : { isActive: true },
                    // Exclude only Sundry Creditors; debtors and un-grouped stay in.
                    ...(hideCreditors
                        ? [{ NOT: { account: { is: { group: { is: { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS } } } } } }]
                        : []),
                    ...(q ? [{
                        OR: [
                            { name: { contains: q, mode: "insensitive" as const } },
                            { phones: { some: { phone: { contains: q } } } },
                            { emails: { some: { email: { contains: q, mode: "insensitive" as const } } } },
                        ],
                    }] : []),
                    ...(paginate ? [afterCursor(cursor)] : []),
                ],
            },
            orderBy: paginate ? NAME_ORDER : { createdAt: "desc" },
            ...(paginate ? { take: BROWSE_PAGE_SIZE } : {}),
            include: {
                _count: { select: { companies: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                account: {
                    select: {
                        id: true,
                        balance: true,
                        normalBalance: true,
                        openingBalance: true,
                        openingBalanceType: true,
                        openingBalanceDate: true,
                        // `name` + `aliases` cost nothing extra here — same relation
                        // already joined for `type` — but let a search HIT on this
                        // page double as a fill for the till's party cache (see
                        // `aliases`/`accountGroup` on the response below).
                        group: { select: { type: true, name: true } },
                        aliases: { select: { alias: true } },
                        _count: { select: { devices: true } },
                    },
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
            account: p.account ? {
                id: p.account.id,
                balance: effectiveAccountBalance(p.account),
                normalBalance: p.account.normalBalance
                    ?? (p.account.group?.type ? defaultNormalBalanceForGroupType(p.account.group.type) : "DEBIT"),
            } : null,
            // Not part of what this page displays — the Contacts row carries them
            // so a caller reading this list has the same fields the party
            // catalogue ships, without a second request.
            aliases: p.account?.aliases.map(a => a.alias) ?? [],
            accountGroup: p.account?.group?.name ?? null,
            accountGroupType: p.account?.group?.type ?? null,
        }));
        // The envelope is opt-in, sent only to a caller that asked to paginate —
        // every existing caller (the "All" parties page, referenceStore) still
        // gets the plain array it always has, unchanged.
        return NextResponse.json(
            paginate ? { items: normalised, nextCursor: nextBrowseCursor(persons, BROWSE_PAGE_SIZE) } : normalised,
        );
    } catch (error) {
        return handleApiError(error, "Failed to fetch people");
    }
}

// POST /api/person — create person + auto-create ledger account + contact rows
//
// Open to any signed-in user. Creating a party is a prerequisite of POS billing,
// ticket intake, and voucher entry — every surface that bills someone needs it.
// Gating it on the Contacts page's `customers:create` imposed a restriction the
// Role page cannot lift: department pools carry only `ui:sidebar:*` links, so
// `customers:create` is not grantable to any role outside all-access admin.
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
