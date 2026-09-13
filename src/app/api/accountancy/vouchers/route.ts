import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAuth, requireVoucherPermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, COMBINED_BRANCH, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { z } from "zod";
import { isBalanced } from "@/modules/accountancy/lib/balance";
import { parseDenomJson } from "@/shared/lib/accountancy/denomJson";
import { engineCreateVoucher } from "@/modules/accountancy/lib/transactionEngine";
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

// Contra deposit-slip capture — the FINAL combined breakdown (notes counts +
// cheque list), stored once on the spine (UniversalVoucher.denomJson).
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
                // Always-true guard — nothing writes `deletedAt` (soft-delete removed 2026-08-01).
                deletedAt: null,
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
                lines:  { select: { type: true, amount: true } },
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
            partyIds.length === 0 ? Promise.resolve([]) : prisma.account.findMany({ where: { id: { in: partyIds } }, select: { id: true, code: true, name: true, personId: true, companyId: true } }),
        ]);
        const creatorById = new Map(creators.map((u) => [u.id, u]));
        const partyById   = new Map(parties.map((a) => [a.id, a]));
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

    // Stamp the working branch onto the spine (5D-12) so branch-aware views like
    // the Day Book can show it. Best-effort: leave org-level (null) when no
    // concrete working branch is active (combined sentinel or unset) rather than
    // blocking creation — unlike inventory writes, a money voucher can be org-level.
    let branchId: string | null = null;
    try {
        const resolved = resolveActiveBranchId(req, await auth());
        if (resolved !== COMBINED_BRANCH) branchId = resolved;
    } catch (e) {
        if (!(e instanceof BranchAccessError)) throw e;
        // no_active_branch / forbidden_branch → org-level, don't block the create.
    }

    try {
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
            // Deposit-slip capture (CONTRA only) — drop empty/zero-only payloads.
            const denom = body.type === "CONTRA" ? parseDenomJson(body.denomJson) : null;
            if (denom) {
                await tx.universalVoucher.update({ where: { id: v.id }, data: { denomJson: denom } });
            }
            return v;
        });
        return NextResponse.json(voucher, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create voucher");
    }
}
