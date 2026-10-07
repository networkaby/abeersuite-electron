import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, after } from "next/server";
import { notifyBill, autoKindForVoucherType } from "@/shared/lib/whatsapp/notifyBill";
import { auth } from "@/auth";
import { requireAuth, requireVoucherPermission } from "@/shared/lib/auth/permissions";
import { requireWritableBranchId } from "@/shared/lib/auth/activeBranch";
import { z } from "zod";
import { isBalanced } from "@/modules/accountancy/lib/balance";
import { parseDenomJson } from "@/shared/lib/accountancy/denomJson";
import { engineCreateVoucher } from "@/modules/accountancy/lib/transactionEngine";
import { autoLinkSettlement } from "@/modules/accountancy/lib/autoLinkSettlement";
import { loadSettlements } from "@/modules/accountancy/lib/billLink";
import { validateRequest } from "@/shared/lib/api";
import { PAYMENT_INSTRUMENT_VALUES } from "@/shared/lib/constants/accounting";
import { handleApiError } from "@/shared/lib/api";

const lineSchema = z.object({
    accountId:   z.number().int().positive(),
    type:        z.enum(["DEBIT", "CREDIT"]),
    amount:      z.number().positive(),
    description: z.string().trim().optional(),
    // Payment instrument (Payment / Receipt: on the Cash/Bank line) — optional.
    method:      z.enum(PAYMENT_INSTRUMENT_VALUES).optional(),
    reference:   z.string().trim().max(60).optional(),
});

// Deposit-slip capture (Contra, or a cash Payment into the party's bank) — the
// FINAL combined breakdown (notes counts + cheque list), stored once on the
// spine (UniversalVoucher.denomJson).
const denomJsonSchema = z.object({
    notes:   z.record(z.string(), z.number().int().min(0)),
    cheques: z.array(z.object({
        no:      z.string().trim().min(1),
        amount:  z.number().positive(),
        account: z.string().trim().optional(),
    })),
});

const createSchema = z.object({
    type:           z.enum(["CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE"]),
    date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    narration:      z.string().trim().optional(),
    partyAccountId: z.number().int().positive().optional(),
    lines:          z.array(lineSchema).min(2, "At least 2 lines required"),
    denomJson:      denomJsonSchema.nullable().optional(),
    // Save & Post in ONE request. The form used to create the draft and then call
    // [id]/post, which is two round trips for what the user sees as one action —
    // and the voucher existed as a DRAFT in between. Same shape as
    // /api/accountancy/journal-vouchers `postImmediately`.
    post:           z.boolean().optional(),
    // false = the form links the bills the user ticked itself, straight after
    // this save — so the server must not link first. Its oldest-first choice
    // would spend the voucher's room, and the ticks would then be refused.
    autoLink:       z.boolean().optional(),
});

// GET /api/accountancy/vouchers?type=CONTRA&status=DRAFT
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE" | null;
    const status = searchParams.get("status") as "DRAFT" | "POSTED" | "CANCELLED" | null;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    // Phase 5 5E: the spine IS the financial voucher (Voucher table dropped). Filter
    // to the financial kinds that used to live in Voucher (the spine also holds
    // SALE/POS/etc., which belong to the inventory registers).
    const FINANCIAL_TYPES = ["CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE", "JOURNAL"];

    try {
        const rows = await prisma.universalVoucher.findMany({
            where: {
                ...(type ? { type } : { type: { in: FINANCIAL_TYPES } }),
                ...(status ? { status } : {}),
                ...(from || to ? {
                    date: {
                        ...(from ? { gte: new Date(from) } : {}),
                        ...(to ? { lte: new Date(to) } : {}),
                    },
                } : {}),
            },
            // `sourceCreatedAt` (when it was posted), not `createdAt` (when the
            // row was inserted) — on a relayed or late-synced write those differ,
            // and only the former is the order a person recognises.
            orderBy: [
                { date: "desc" },
                { sourceCreatedAt: { sort: "desc", nulls: "last" } },
                { createdAt: "desc" },
            ],
            include: {
                // `accountId` is here for the bill-wise chip — the party's own leg
                // on this voucher. These lines are already loaded for the total
                // below, so it costs no extra query.
                lines:  { select: { type: true, amount: true, accountId: true } },
                // 5D-12: branch is primary on the spine — read it straight off the
                // header (the old per-line VoucherGlLine.branchId scan is gone).
                branch: { select: { id: true, name: true } },
            },
        });
        // Enrich the relations the scalar spine lacks (createdBy / partyAccount) and
        // compute totalAmount (Σ debit legs) — preserving the old Voucher response shape.
        const creatorIds = [...new Set(rows.map((v) => v.createdById))];
        const partyIds   = [...new Set(rows.map((v) => v.partyAccountId).filter((x): x is number => x != null))];
        const [creators, parties] = await Promise.all([
            prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }),
            partyIds.length === 0 ? Promise.resolve([]) : prisma.account.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true, personId: true, companyId: true } }),
        ]);
        const creatorById = new Map(creators.map((u) => [u.id, u]));
        const partyById   = new Map(parties.map((a) => [a.id, a]));

        // Bill-wise settlement — Settled / Partial / Due, the same chip the
        // party's own Transactions tab shows. The party leg comes off the lines
        // already loaded, so the only added cost is `sumLinked`.
        const partyMovement = new Map<number, number>();
        for (const v of rows) {
            if (v.partyAccountId == null) continue;
            let movement = 0;
            for (const l of v.lines) {
                if (l.accountId !== v.partyAccountId) continue;
                movement += l.type === "DEBIT" ? Number(l.amount) : -Number(l.amount);
            }
            partyMovement.set(v.id, movement);
        }
        const settlements = await loadSettlements(
            prisma,
            rows.map((v) => ({
                universalVoucherId: v.id,
                partyAccountId:     v.partyAccountId,
                kind:               v.type,
                status:             v.status,
            })),
            partyMovement,
        );
        // 5D-12: branch is read straight off the spine (`branch` relation included
        // above) so branch-aware views like the Day Book can show it. Org-level
        // vouchers (no working branch at create time) carry null.
        const vouchers = rows.map((v) => ({
            ...v,
            createdBy:    creatorById.get(v.createdById) ?? null,
            partyAccount: v.partyAccountId != null ? (partyById.get(v.partyAccountId) ?? null) : null,
            totalAmount:  v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0),
            branch:       v.branch ?? null,
            _count:       { lines: v.lines.length },
            /** Bill-wise state — null where there is no bill to settle. */
            settlement:     settlements[v.id]?.state ?? null,
            settlementOpen: settlements[v.id]?.open  ?? 0,
            canLink:        settlements[v.id]?.canLink ?? false,
        }));

        return NextResponse.json(vouchers);
    } catch (e) {
        return handleApiError(e, "Failed to fetch vouchers");
    }
}

// POST /api/accountancy/vouchers
export async function POST(req: Request) {
    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    const body = data;

    // Per-kind create gate (falls back to the generic finance:voucher:create).
    const { user, response } = await requireVoucherPermission(body.type, "create");
    if (response) return response;

    // Posting is a SEPARATE right. Someone who may raise a voucher but not post it
    // keeps the draft button and nothing else — the flag must not be a way around
    // the gate the standalone post route enforces.
    if (body.post) {
        const posting = await requireVoucherPermission(body.type, "post");
        if (posting.response) return posting.response;
    }

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Voucher is not balanced — debits must equal credits" }, { status: 422 });
    }

    // A counter's till cash moves only through a POS shift (those post via their
    // own routes, not this one). A Payment / Receipt here on a till would throw
    // the shift's cash count. Contra stays open — that is Vault ↔ Counter.
    if (body.type === "PAYMENT" || body.type === "RECEIPT") {
        const till = await prisma.posCounter.findFirst({
            where:  { tillAccountId: { in: body.lines.map((l) => l.accountId) } },
            select: { name: true },
        });
        if (till) {
            return NextResponse.json(
                { error: `${till.name}'s till cash moves only through POS. Use a Contra to move it, or pick another cash / bank ledger.` },
                { status: 422 },
            );
        }
    }

    // Stamp the working branch onto the spine (5D-12). EVERY voucher carries a
    // branch — a blank one silently drops the voucher out of every branch-wise
    // report, which is what "org-level money voucher" used to mean in practice.
    // So "All branches" is refused here (`select_working_branch` → 400, the
    // screen shows "…switch to a specific branch to post this transaction")
    // rather than quietly saved as null. Throws → handleApiError answers it.
    try {
        const branchId = requireWritableBranchId(req, await auth());

        // Create the voucher through the Transaction Engine — DRAFT, or straight
        // to POSTED when the caller asked for both. A draft takes no number; the
        // series advances only on the posting leg.
        const voucher = await prisma.$transaction(async (tx) => {
            const v = await engineCreateVoucher(tx, {
                type:           body.type,
                date:           new Date(body.date),
                userId:         user!.id,
                lines:          body.lines,
                narration:      body.narration ?? null,
                partyAccountId: body.partyAccountId ?? null,
                branchId,
                post:           body.post ?? false,
            });
            // Deposit-slip capture (CONTRA, and a cash PAYMENT into the party's
            // bank) — drop empty/zero-only payloads.
            const denom = body.type === "CONTRA" || body.type === "PAYMENT" ? parseDenomJson(body.denomJson) : null;
            if (denom) {
                await tx.universalVoucher.update({ where: { id: v.id }, data: { denomJson: denom } });
            }
            return v;
        });

        // Settle a posted Receipt / Payment against the party's open bills when
        // nobody ticked any — before this, every such voucher sat on the party's
        // ledger settling nothing. When the form DID tick bills it sends
        // `autoLink: false` and places them itself (`settleFromPicks`), because
        // linking here first would leave its ticks no room. Deliberately AFTER
        // the create transaction: a refusal here must cost only the link, and the
        // create runs on Prisma's 5s default while linking wants its own 30s and
        // the party lock. Never throws; the bill-link popup and
        // `pnpm reconcile:bill-links` both remain able to place it by hand.
        //
        // Only POSTED and only with a named party: a draft has no GL legs to read
        // and `assertLinkPlan` refuses one outright, and a link is measured on a
        // party ledger, which `partyAccountId` is the only thing that names.
        let settled: Awaited<ReturnType<typeof autoLinkSettlement>> | null = null;
        if ((body.post ?? false) && body.autoLink !== false && body.partyAccountId != null
            && (body.type === "RECEIPT" || body.type === "PAYMENT")) {
            settled = await autoLinkSettlement({
                voucherId: voucher.id,
                accountId: body.partyAccountId,
                userId:    user!.id,
                reference: voucher.reference ?? null,
            });
        }

        const notifyKind = (body.post ?? false) ? autoKindForVoucherType(body.type) : null;
        if (notifyKind) after(() => notifyBill(notifyKind, voucher.id));

        return NextResponse.json(
            settled
                ? { ...voucher, settled: settled.links, settledTotal: settled.linkedTotal, leftAsAdvance: settled.leftAsAdvance }
                : voucher,
            { status: 201 },
        );
    } catch (e) {
        return handleApiError(e, "Failed to create voucher");
    }
}
