/**
 * GET /api/search-slno?q=<SL no>
 *
 * The SL Search dialog's one engine — "a customer has the unit but no bill, and
 * forgot the name / phone they bought it under".
 *
 *   bills   — every POSTED voucher line whose NOTE carries the SL no. There is no
 *             serial column: the SL no lives in the line note, which the POS
 *             forces for products marked "Must fill line note". All voucher types
 *             come back, so the unit's whole story shows (purchase → sale → return).
 *   tickets — repair and help-desk tickets that mention it (warranty ref, service
 *             centre ref, accessories, device model / problem, title, notes,
 *             help subject). `accessInfo` (device PIN / pattern) is never searched.
 *
 * Any signed-in staff member may call it, like the home panel's repair lookup:
 * whoever faces the walk-in must be able to answer.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { readPartyName, readPartyPhone } from "@/shared/lib/accountancy/partySnapshot";
import { SL_SEARCH_MIN_CHARS, type SlSearchResult } from "@/shared/lib/search/slSearch";

const BILL_LIMIT = 50;
const TICKET_LIMIT = 20;

/** The note part of a line description. The POS saves `"<sku> — <name> · <note>"`
 *  (PosScreen), so matching the whole string would also hit a SKU or a word in the
 *  product name; office forms save the note alone. */
function lineNote(description: string, sku: string): string {
    if (!description.startsWith(`${sku} — `)) return description;
    const cut = description.indexOf(" · ");
    return cut === -1 ? "" : description.slice(cut + 3);
}

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

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
                    description: has,
                    universalVoucher: { status: "POSTED", deletedAt: null },
                },
                orderBy: [{ universalVoucher: { date: "desc" } }, { id: "desc" }],
                // Over-fetch: a POS line can match on its SKU / name prefix and be
                // dropped below, so the note-only cut still fills the page.
                take: BILL_LIMIT * 2,
                select: {
                    id: true,
                    description: true,
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
                                    account: { select: { name: true } },
                                },
                            },
                        },
                    },
                    help: {
                        select: {
                            subject: true, contactName: true, phone: true,
                            person: { select: { name: true } },
                            company: { select: { name: true } },
                        },
                    },
                },
            }),
        ]);

        const billLines = lines
            .map((l) => ({ ...l, note: lineNote(l.description ?? "", l.product.sku) }))
            .filter((l) => l.note.toLowerCase().includes(needle))
            .slice(0, BILL_LIMIT);

        // Ledger name is the fallback when the bill froze no party snapshot.
        const acctIds = [...new Set(billLines.map((l) => l.universalVoucher.partyAccountId).filter((x): x is number => x != null))];
        const acctName = new Map(
            (acctIds.length === 0 ? [] : await prisma.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, name: true } }))
                .map((a) => [a.id, a.name]),
        );

        const result: SlSearchResult = {
            bills: billLines.map((l) => {
                const uv = l.universalVoucher;
                const partyJson = uv.voucherDetail?.partyJson;
                return {
                    lineId: l.id,
                    detailId: uv.voucherDetail?.id ?? null,
                    type: uv.type,
                    voucherNo: uv.voucherNo,
                    date: uv.date.toISOString().slice(0, 10), // @db.Date — a calendar date, no time
                    partyName: readPartyName(partyJson) ?? (uv.partyAccountId != null ? acctName.get(uv.partyAccountId) ?? null : null),
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
