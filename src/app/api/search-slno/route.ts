/**
 * GET /api/search-slno?q=<SL no>
 *
 * The SL Search dialog's one engine — "a customer has the unit but no bill, and
 * forgot the name / phone they bought it under".
 *
 *   bills   — every POSTED voucher line whose NOTE carries the SL no. There is no
 *             serial column: the SL no lives in the line note, which the POS
 *             forces for products marked "Must fill line note". Every voucher type
 *             comes back, so the unit's whole story shows (GRN / purchase → sale /
 *             challan → return) — the supplier side only to a role holding
 *             "Show suppliers" (`customers:view:creditors`).
 *   tickets — repair and help-desk tickets that mention it (warranty ref, service
 *             centre ref, accessories, device model / problem, title, notes,
 *             help subject). `accessInfo` (device PIN / pattern) is never searched.
 *
 * Any signed-in staff member may call it, like the home panel's repair lookup:
 * whoever faces the walk-in must be able to answer.
 */

import { NextResponse } from "next/server";
import { readLineText } from "@/shared/lib/print/lineDescription";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasPermission, requireAuth } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { PER_KIND } from "@/modules/accountancy/lib/tradingVoucherKinds";
import { handleApiError } from "@/shared/lib/api";
import { readPartyName, readPartyPhone } from "@/shared/lib/accountancy/partySnapshot";
import { NO_PARTY_LINK, partyLinkFields, type PartyLinkFields } from "@/shared/lib/parties/partyLink";
import { resolvePartyLinks } from "@/shared/lib/parties/partyLinkServer";
import { SL_SEARCH_MIN_CHARS, type SlSearchResult } from "@/shared/lib/search/slSearch";

const BILL_LIMIT = 50;
const TICKET_LIMIT = 20;

/** Supplier-side documents — purchase, purchase return / order, GRN, rejection
 *  out: every trading kind whose party is a Sundry Creditor. Shown only to a
 *  role holding "Show suppliers", the same tick that hides suppliers from the
 *  Contacts lists and party pickers. */
const SUPPLIER_SIDE_TYPES = Object.entries(PER_KIND)
    .filter(([, kind]) => kind.party === "Sundry Creditors")
    .map(([type]) => type);

/** A ledger Account's party profile. The Account is the LIVE link — a merge or a
 *  conversion moves it onto the surviving record — so no forwarding walk is needed. */
function accountPartyLink(a: { personId: number | null; companyId: number | null } | null | undefined): PartyLinkFields {
    if (a?.personId != null) return { partyKind: "person", partyEntityId: a.personId };
    if (a?.companyId != null) return { partyKind: "company", partyEntityId: a.companyId };
    return NO_PARTY_LINK;
}

export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const seesSuppliers = hasPermission(user, PERMISSIONS.CUSTOMERS_VIEW_CREDITORS);

    try {
        const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
        if (q.length < SL_SEARCH_MIN_CHARS) {
            return NextResponse.json({ error: `Enter at least ${SL_SEARCH_MIN_CHARS} characters` }, { status: 400 });
        }
        const has = { contains: q, mode: "insensitive" as const };
        const needle = q.toLowerCase();

        const [lines, tickets] = await Promise.all([
            prisma.voucherInventoryLine.findMany({
                where: {
                    // The note column; a line from before it kept the note in
                    // its text ("<sku> — <name> · <note>").
                    OR: [{ note: has }, { description: has }],
                    universalVoucher: {
                        status: "POSTED",
                        // Filtered in the query, not after it, so the page still fills.
                        ...(seesSuppliers ? {} : { type: { notIn: SUPPLIER_SIDE_TYPES } }),
                    },
                },
                orderBy: [{ universalVoucher: { date: "desc" } }, { id: "desc" }],
                // Over-fetch: a POS line can match on its SKU / name prefix and be
                // dropped below, so the note-only cut still fills the page.
                take: BILL_LIMIT * 2,
                select: {
                    id: true,
                    description: true,
                    note: true,
                    quantity: true,
                    product: { select: { name: true, sku: true } },
                    universalVoucher: {
                        select: {
                            type: true,
                            voucherNo: true,
                            date: true,
                            partyAccountId: true,
                            voucherDetail: { select: { id: true, partyJson: true } },
                        },
                    },
                },
            }),
            prisma.ticket.findMany({
                where: {
                    OR: [
                        { repair: { warrantyRef: has } },
                        { repair: { externalRef: has } },
                        { repair: { accessories: has } },
                        { repair: { device: { model: has } } },
                        { repair: { device: { problem: has } } },
                        { help: { subject: has } },
                        { title: has, OR: [{ repair: { isNot: null } }, { help: { isNot: null } }] },
                        { notes: has, OR: [{ repair: { isNot: null } }, { help: { isNot: null } }] },
                    ],
                },
                orderBy: { updatedAt: "desc" },
                take: TICKET_LIMIT,
                select: {
                    id: true,
                    title: true,
                    notes: true,
                    createdAt: true,
                    ticketStatus: { select: { label: true, color: true } },
                    repair: {
                        select: {
                            warrantyRef: true,
                            externalRef: true,
                            accessories: true,
                            device: {
                                select: {
                                    brand: true, model: true, problem: true,
                                    account: { select: { name: true, personId: true, companyId: true } },
                                },
                            },
                        },
                    },
                    help: {
                        select: {
                            subject: true, contactName: true, phone: true,
                            personId: true, companyId: true,
                            person: { select: { name: true } },
                            company: { select: { name: true } },
                        },
                    },
                },
            }),
        ]);

        const billLines = lines
            // The note part only — matching the item text would also hit a SKU or a
            // word in the product name.
            .map((l) => ({ ...l, note: readLineText(l, l.product).note ?? "" }))
            .filter((l) => l.note.toLowerCase().includes(needle))
            .slice(0, BILL_LIMIT);

        // The bill's party ledger: its name is the fallback when the bill froze no
        // party snapshot, and its person / company is the profile the name opens.
        const acctIds = [...new Set(billLines.map((l) => l.universalVoucher.partyAccountId).filter((x): x is number => x != null))];
        const acctById = new Map(
            (acctIds.length === 0 ? [] : await prisma.account.findMany({
                where: { id: { in: acctIds } },
                select: { id: true, name: true, personId: true, companyId: true },
            })).map((a) => [a.id, a]),
        );

        // A help ticket stores the party id it was raised against, which a later
        // merge or conversion leaves behind — follow the forwarding note.
        const helpRef = (h: { personId: number | null; companyId: number | null } | null) => ({
            partyId: h?.personId ?? h?.companyId ?? null,
            partyType: h?.personId != null ? "customer" : h?.companyId != null ? "company" : null,
        });
        const helpLinks = await resolvePartyLinks(prisma, tickets.map((t) => helpRef(t.help)));

        const result: SlSearchResult = {
            bills: billLines.map((l) => {
                const uv = l.universalVoucher;
                const partyJson = uv.voucherDetail?.partyJson;
                const acct = uv.partyAccountId != null ? acctById.get(uv.partyAccountId) : undefined;
                return {
                    ...accountPartyLink(acct),
                    lineId: l.id,
                    detailId: uv.voucherDetail?.id ?? null,
                    type: uv.type,
                    voucherNo: uv.voucherNo,
                    date: uv.date.toISOString().slice(0, 10), // @db.Date — a calendar date, no time
                    partyName: readPartyName(partyJson) ?? acct?.name ?? null,
                    partyPhone: readPartyPhone(partyJson),
                    productName: l.product.name,
                    note: l.note,
                    quantity: Number(l.quantity),
                };
            }),
            tickets: tickets.map((t) => {
                const r = t.repair;
                const h = t.help;
                // First field that carries the SL no — tells staff why this ticket is here.
                const fields: [string, string | null | undefined][] = [
                    ["Warranty ref", r?.warrantyRef],
                    ["Service centre ref", r?.externalRef],
                    ["Model", r?.device.model],
                    ["Problem", r?.device.problem],
                    ["Accessories", r?.accessories],
                    ["Subject", h?.subject],
                    ["Title", t.title],
                    ["Notes", t.notes],
                ];
                const hit = fields.find(([, v]) => v?.toLowerCase().includes(needle));
                return {
                    ...(r ? accountPartyLink(r.device.account) : partyLinkFields(helpLinks.for(helpRef(h)))),
                    id: t.id,
                    kind: r ? "repair" : "help",
                    status: t.ticketStatus,
                    customerName: r?.device.account?.name ?? h?.person?.name ?? h?.company?.name ?? h?.contactName ?? null,
                    customerPhone: h?.phone ?? null,
                    device: r ? `${r.device.brand} ${r.device.model}`.trim() : null,
                    matchedField: hit?.[0] ?? null,
                    matchedText: hit?.[1] ?? null,
                    createdAt: t.createdAt.toISOString(),
                };
            }),
        };

        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Failed to search SL no");
    }
}
