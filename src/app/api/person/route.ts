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
import { looksLikeEmail, looksLikePhone } from "@/shared/lib/parties/tokenShape";
import { afterCursor, BROWSE_PAGE_SIZE, NAME_ORDER, nextBrowseCursor, parseBrowseCursor } from "@/shared/lib/parties/browsePage";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { searchPartyRows, normalisePartyQuery } from "@/shared/lib/parties/partySearch";

/** Rows a lookup returns. Each side of the union takes a full page, so the
 *  ranked merge can choose between them rather than persons crowding companies
 *  out before anything has been compared. */
const MAX_LOOKUP_ROWS = 8;

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
} & Partial<FullFields>;

/**
 * What `full=1` adds — the fields this lookup MATCHES on but does not normally
 * show. A hit is displayed with its primary phone, yet found by any of them, by
 * a ledger alias, and narrowed by account group.
 *
 * Only the browser's party cache asks for these, and only where it is allowed to
 * keep parties at all (`partyCatalog.ts`, counter-only). A row cached without
 * them would search more narrowly than the server does, so the same customer
 * would be found by typing on one machine and missing on another. Off by default
 * so every other caller — and every unbridged machine — keeps pulling the
 * smaller row, with no secondary phone or email on the wire at all.
 */
type FullFields = {
    phones: string[];
    emails: string[];
    aliases: string[];
    accountGroup: string | null;
    accountGroupType: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null;
};

async function lookupAccounts(
    term: string,
    group?: string,
    // `wide` no longer selects any fields — address and email are always
    // searched now. Accepted so the callers that pass it keep compiling.
    opts?: { wide?: boolean; full?: boolean },
): Promise<LookupResult[]> {
    const full = opts?.full ?? false;
    // Read whole — eight rows' worth of phones and aliases is not worth a second
    // query shape to avoid. What `full` decides is what goes ON THE WIRE below.
    const contacts = { orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }] };
    const accountInclude = {
        account: {
            select: {
                id: true,
                group: { select: { name: true, type: true } },
                aliases: { select: { alias: true } },
            },
        },
    };
    // When `group` is set (e.g. "Sundry Debtors" / "Sundry Creditors") we
    // restrict the hits to parties whose ledger sits under that group. Lets
    // CN / Sale pick only customers, DN / Purchase pick only suppliers.
    const accountGroupFilter = group
        ? { account: { is: { group: { is: { name: group } } } } }
        : {};

    // A token may match ANY field the dropdown shows. `wide` used to gate address
    // and email, and it cost the operator the commonest lookup there is: half a
    // name plus a locality ("rosy fancy") matched nothing, because `fancy` was
    // only ever compared against names. Showing an address on the row and then
    // refusing to search it is not a saving, it is a lie — and it is not even a
    // saving: `address` is a plain COLUMN on both tables, so unlike `phones` and
    // `emails` it costs no join, and the email branch is still only built when the
    // token is actually email-shaped. `wide` is kept for callers that pass it, but
    // nothing depends on it to reach these two fields any more.
    const tokenOr = (t: string) => ({
        OR: [
            { name: { contains: t, mode: "insensitive" as const } },
            { address: { contains: t, mode: "insensitive" as const } },
            ...(looksLikeEmail(t)
                ? [{ emails: { some: { email: { contains: t, mode: "insensitive" as const } } } }]
                : []),
            // Phone and email only enter the query when the token is actually
            // shaped like one — the UI already knows what it's typing, so this is
            // the same saving as the exact-match version without the cost of a
            // narrower match: a name token never asks Postgres to scan the
            // phone/email columns, and a real phone/email still finds a partial
            // typed prefix.
            ...(looksLikePhone(t) ? [{ phones: { some: { phone: { contains: t } } } }] : []),
            { account: { is: { aliases: { some: { alias: { contains: t, mode: "insensitive" as const } } } } } },
        ],
    });

    // Split multi-word queries (e.g. "abeer 9954") into tokens and AND them —
    // each token must match name / address / phone / email / alias.
    //
    // Normalised first, because a phone is dictated and pasted with punctuation
    // in it. Phones are STORED as bare digits, so "+91 99540-12345" matched
    // nothing at all — the "+" and the "-" made it look like a name. See
    // normalisePartyQuery; it leaves everything that is not a number alone.
    const normalised = normalisePartyQuery(term);
    const tokens = normalised.split(/\s+/).filter(Boolean);
    const tokenFilter = tokens.length <= 1
        ? tokenOr(normalised)
        : { AND: tokens.map(tokenOr) };

    const [persons, companies] = await Promise.all([
        prisma.person.findMany({
            where: {
                isActive: true,
                ...accountGroupFilter,
                ...tokenFilter,
            },
            include: {
                ...accountInclude,
                phones: contacts,
                emails: contacts,
                companies: {
                    where: { unlinkedAt: null },
                    include: {
                        company: {
                            select: { id: true, name: true, account: { select: { id: true } } },
                        },
                    },
                },
            },
            // Both sides take a FULL page each, and the merge below ranks them
            // together before cutting. Taking 8 and 8 then slicing persons-first
            // meant a company could never appear at all once 8 people matched —
            // a company whose name is also a common person name was unreachable
            // from the box.
            take: MAX_LOOKUP_ROWS,
            orderBy: { createdAt: "desc" },
        }),
        prisma.company.findMany({
            where: {
                isActive: true,
                ...accountGroupFilter,
                ...tokenFilter,
            },
            include: {
                ...accountInclude,
                phones: contacts,
                emails: contacts,
            },
            take: MAX_LOOKUP_ROWS,
            orderBy: { createdAt: "desc" },
        }),
    ]);

    /** The matched-on-but-not-shown fields, only when `full=1` asked for them. */
    const extras = (row: {
        phones: { phone: string }[];
        emails: { email: string }[];
        account: {
            group: { name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" } | null;
            aliases: { alias: string }[];
        } | null;
    }): Partial<FullFields> => full
        ? {
            phones: row.phones.map(x => x.phone),
            emails: row.emails.map(x => x.email),
            aliases: row.account?.aliases.map(a => a.alias) ?? [],
            accountGroup: row.account?.group?.name ?? null,
            accountGroupType: row.account?.group?.type ?? null,
        }
        : {};

    const merged = [
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
            ...extras(p),
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
            ...extras(c),
        })),
    ];

    // Rank before cutting. Postgres can only give us `contains` in `createdAt`
    // order — that is "whoever registered most recently", not "whoever matches
    // best", so an exact name from 2019 fell off the bottom under a partial
    // match added last week, and typing "hri" led with Tas(hri)f instead of
    // Hridoy. The same matcher the counter runs in memory does the ordering
    // here, so the two agree about what belongs at the top.
    // Rank over the phone/email the row actually carries. Without `full=1` the
    // arrays are absent and only the primary `phone`/`email` came back — feeding
    // the matcher a row with no phone in it at all would score a phone query
    // ZERO and drop every result on the floor.
    const ranked = searchPartyRows(
        merged.map((r) => ({
            ...r,
            phones: r.phones ?? (r.phone ? [r.phone] : []),
            emails: r.emails ?? (r.email ? [r.email] : []),
        })),
        normalised,
        { rows: MAX_LOOKUP_ROWS },
    ).rows;
    // Hand back the rows as they were built — the arrays above were for matching
    // only, and `full=1` decides what is allowed on the wire.
    const order = new Map(ranked.map((r, i) => [`${r.type}:${r.id}`, i]));
    return merged
        .filter((r) => order.has(`${r.type}:${r.id}`))
        .sort((a, b) => order.get(`${a.type}:${a.id}`)! - order.get(`${b.type}:${b.id}`)!);
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
    // Opt-in: return the fields the lookup matches on but does not show, so the
    // browser's party cache can search its copy the way the server searches.
    const full = searchParams.get("full") === "1";
    // Browse-only supplier filter — a role without `customers:view:creditors`
    // passes this to drop parties in the Sundry Creditors group. Applied to the
    // browse list ONLY; the lookup path below is never filtered so party pickers
    // (repair service slips, vouchers) still find suppliers.
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
        if (phone) return NextResponse.json(await lookupAccounts(phone, group, { wide, full }));
        // lookup !== undefined means the param was explicitly passed (even if empty),
        // allowing ?lookup=&group=... to browse the full group list on focus.
        if (lookup !== undefined) return NextResponse.json(await lookupAccounts(lookup, group, { wide, full }));

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
            // Cache-fill fields, same shape `full=1` sends from the lookup. Not
            // part of what this page displays — only what a search HIT here can
            // hand the till's cache for free.
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
