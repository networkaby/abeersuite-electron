import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { ContactConflictError } from "@/modules/customer/lib/contactWrite";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { canonicalPhone, PhoneFormatError } from "@/shared/lib/format/phone";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";
import { loadPartyUnallocated } from "@/modules/accountancy/lib/billLink";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { phoneEmailSchema, gstSchema } from "@/shared/lib/schemas/commonSchemas";
import { afterCursor, NAME_ORDER, nextBrowseCursor, parseBrowseCursor } from "@/shared/lib/parties/browsePage";
import { BROWSE_PAGE_SIZE } from "@/shared/lib/constants/paging";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { aliasKeyOf } from "@/modules/accountancy/lib/accountAlias";

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
    // Opt-in, and deliberately so. `toLink` costs two more queries over every GL
    // line these parties have ever had — worth it for the three customer list
    // pages that show the broken-chain mark, wasted on the till's party cache
    // and every voucher picker, which call this route and never draw it. Same reasoning as `paginate` above.
    const withLinkHint = searchParams.get("withLinkHint") === "1";

    try {
        const persons = await prisma.person.findMany({
            where: {
                AND: [
                    ...(includeInactive ? [] : [{ isActive: true }]),
                    // Exclude only Sundry Creditors; debtors and un-grouped stay in.
                    ...(hideCreditors
                        ? [{ NOT: { account: { is: { group: { is: { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS } } } } } }]
                        : []),
                    ...(q ? [{
                        OR: [
                            { name: { contains: q, mode: "insensitive" as const } },
                            { phones: { some: { phone: { contains: q } } } },
                            { emails: { some: { email: { contains: q, mode: "insensitive" as const } } } },
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
                _count: { select: { companies: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                account: {
                    select: {
                        id: true,
                        // No `balance` / `openingBalance*`: the figure this page
                        // shows is summed from the GL lines below, so reading the
                        // cached column here would only invite the two to disagree.
                        normalBalance: true,
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

        // Balances come from the GL lines of just these parties, not from the
        // `Account.balance` cache. Each counter holds a full local replica, so
        // one narrowed aggregate over the accounts already on this page is a
        // cheap indexed read — and unlike the cache it cannot drift away from
        // the ledger the party's own statement is printed from.
        //
        // No date ceiling: this column means "what stands on the account", the
        // same total the cache carried, not a position as of today.
        const accountIds = persons.map(p => p.account?.id).filter((id): id is number => id != null);
        const [closing, unallocated] = await Promise.all([
            closingForAccounts(null, accountIds),
            withLinkHint ? loadPartyUnallocated(prisma, accountIds) : Promise.resolve(null),
        ]);

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
                balance: closing.get(p.account.id) ?? 0,
                normalBalance: p.account.normalBalance
                    ?? (p.account.group?.type ? defaultNormalBalanceForGroupType(p.account.group.type) : "DEBIT"),
                ...(unallocated ? { toLink: unallocated.get(p.account.id)?.toLink ?? 0 } : {}),
            } : null,
            // Not part of what this page displays — the Contacts row carries them
            // so a caller reading this list has the same fields the party
            // catalogue ships, without a second request.
            aliases: p.account?.aliases.map(a => a.alias) ?? [],
            accountGroup: p.account?.group?.name ?? null,
            accountGroupType: p.account?.group?.type ?? null,
        }));
        // The envelope is opt-in, sent only to a caller that asked to paginate —
        // every other caller (the till's party cache, the voucher pickers) still
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

    // Stored form per canonicalPhone; `+91…` and bare 10 digits are one number.
    const typedPhones = body.phones.filter(p => p.trim().length > 0);
    const badPhone = typedPhones.find(p => !canonicalPhone(p));
    if (badPhone) return handleApiError(new PhoneFormatError(badPhone));
    const phones = [...new Set(typedPhones.map(p => canonicalPhone(p)!))];
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

            // Staff-entered contacts count as verified; only a customer's own app add waits for OTP.
            const now = new Date();
            for (let i = 0; i < phones.length; i++) {
                await tx.phone.create({
                    data: { phone: phones[i], personId: p.id, isPrimary: i === 0, verifiedAt: now },
                });
            }
            for (let i = 0; i < emails.length; i++) {
                await tx.email.create({
                    data: { email: emails[i], personId: p.id, isPrimary: i === 0, verifiedAt: now },
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

        // From where it was saved: a replica-reading counter does not have the row yet.
        const full = await prismaWhereSaved().person.findUniqueOrThrow({
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
